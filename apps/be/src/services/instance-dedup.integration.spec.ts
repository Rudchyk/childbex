/**
 * DICOM instance deduplication of real archive imports against PostgreSQL:
 * identity by SOP Instance UID + file hash, conflicts, rollback without
 * leftovers (rows and files) and concurrent imports.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_dedup" (created when missing); every test
 * recreates its `public` schema and upload storage.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize } from 'sequelize';
import {
  buildTar,
  makeSyntheticDicom,
  type SyntheticDicomOptions,
} from './archive/__fixtures__/synthetic';
import type * as MigratorModule from '../db/migrator';
import type * as PatientsServiceModule from './patients.service';

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('./logger.service', () => ({ logger: mockLogger }));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL deduplication tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const STUDY_B = '2.25.200000000000000000000000002';
const SERIES_B = '2.25.300000000000000000000000002';
const sopOf = (instance: number) => `2.25.1000000000000000000000000${instance}`;

describeWithDatabase('DICOM instance deduplication (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let importPatientArchiveFile: typeof PatientsServiceModule.importPatientArchiveFile;
  let tmp: string;
  let uploadRoot: string;
  let archiveCount = 0;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_dedup`;
    if (!/test/i.test(database)) {
      throw new Error(`TEST_DATABASE_URL must name a test database (got "${database}").`);
    }
    if (url.port && url.port !== '5432') {
      throw new Error('TEST_DATABASE_URL must use port 5432 (DB_* has no port).');
    }
    const admin = new Sequelize(databaseUrl as string, { logging: false });
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', {
      bind: [database],
      type: QueryTypes.SELECT,
    });
    if (!exists.length) await admin.query(`CREATE DATABASE "${database}"`);
    await admin.close();

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-dedup-'));
    uploadRoot = path.join(tmp, 'uploads');
    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.ARCHIVES_ROOT = path.join(tmp, 'archives');
    process.env.ARCHIVE_WORK_DIR = path.join(tmp, 'work');
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    ({ importPatientArchiveFile } = require('./patients.service'));
    ({ sequelize } = require('../db/sequelize'));
    migrator = require('../db/migrator');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    await migrator.migrateUp(sequelize);
    for (const id of [P1, P2]) {
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now())`,
        { bind: [id, `synthetic-${id.slice(0, 4)}`] }
      );
    }
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Helpers -----------------------------------------------------------------

  const count = async (table: string, where = 'TRUE') => {
    const [row] = await sequelize.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
      { type: QueryTypes.SELECT }
    );
    return Number(row.n);
  };
  const snapshot = async () => ({
    studies: await count('studies'),
    series: await count('series'),
    clusters: await count('patient_images_clusters'),
    images: await count('patients_images'),
    files: await storedFiles(),
  });
  /** All files in the upload storage (relative paths). */
  const storedFiles = async (): Promise<string[]> => {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push(path.relative(uploadRoot, full).split(path.sep).join('/'));
      }
    };
    await walk(uploadRoot);
    return out.sort();
  };

  /** A real archive import; entries are [archive file name, DICOM options]. */
  const importFiles = async (
    patientId: string,
    entries: [name: string, options: SyntheticDicomOptions][]
  ) => {
    // Taken before the first await: concurrent calls get their own numbers.
    const number = ++archiveCount;
    const bytes = await buildTar(
      entries.map(([name, options]) => ({ name, data: makeSyntheticDicom(options) }))
    );
    const archivePath = path.join(tmp, `archive-${number}.tar`);
    await writeFile(archivePath, bytes);
    return importPatientArchiveFile({
      uploadId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
      patientId,
      archivePath,
      extension: '.tar',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  };

  /** Another file content with the same SOP UID (other pixel size). */
  const otherContent = (instance: number): SyntheticDicomOptions => ({
    instance,
    rows: 8,
    cols: 8,
  });

  // --- Identity ----------------------------------------------------------------

  it('same file name, different SOP UIDs: both instances are imported', async () => {
    await importFiles(P1, [['DICOM/IM0', { instance: 1 }]]);
    const second = await importFiles(P1, [['DICOM/IM0', { instance: 2 }]]);

    expect(second).toMatchObject({ importedImages: 1, alreadyImported: 0 });
    const rows = await sequelize.query<{ sopInstanceUid: string; source: string }>(
      `SELECT "sopInstanceUid", source FROM patients_images ORDER BY "sopInstanceUid"`,
      { type: QueryTypes.SELECT }
    );
    expect(rows.map(({ sopInstanceUid }) => sopInstanceUid)).toEqual([sopOf(1), sopOf(2)]);
    // The second file got a free storage name next to the first one.
    expect(rows.map(({ source }) => path.basename(source)).sort()).toEqual(['IM0', 'IM0_1']);
  });

  it('different file name, same SOP UID and content: one row, no second file', async () => {
    await importFiles(P1, [['A/IM0', { instance: 1 }]]);
    const before = await snapshot();

    const second = await importFiles(P1, [['B/RENAMED.dcm', { instance: 1 }]]);

    expect(second).toMatchObject({ importedImages: 0, alreadyImported: 1 });
    expect(await snapshot()).toEqual(before);
    expect(await count('patients_images', `"sopInstanceUid" = '${sopOf(1)}'`)).toBe(1);
  });

  it('keeps id, review state and votes of the existing instance', async () => {
    await importFiles(P1, [['IM0', { instance: 1 }]]);
    await sequelize.query(
      `UPDATE patients_images SET status = 'abnormal', notes = 'reviewed',
         "votesCount" = 1, "abnormalVotes" = 1, "updatedAt" = '2020-01-01T00:00:00Z'`
    );
    await sequelize.query(
      `INSERT INTO patient_image_review_votes (id, "patientImageId", "reviewerId",
         "reviewerName", vote, "createdAt", "updatedAt")
       SELECT '99999999-9999-4999-8999-999999999999', id, 'r', 'R', 'abnormal', now(), now()
       FROM patients_images`
    );
    const [before] = await sequelize.query(`SELECT * FROM patients_images`, {
      type: QueryTypes.SELECT,
    });

    await importFiles(P1, [['OTHER', { instance: 1 }]]);

    const after = await sequelize.query(`SELECT * FROM patients_images`, {
      type: QueryTypes.SELECT,
    });
    expect(after).toEqual([before]);
    expect(await count('patient_image_review_votes')).toBe(1);
  });

  it('an instance already stored in another cluster stays there (already imported)', async () => {
    await importFiles(P1, [['B/IM1', { instance: 1 }]]);
    const [{ clusterId }] = await sequelize.query<{ clusterId: string }>(
      `SELECT "clusterId" FROM patients_images`,
      { type: QueryTypes.SELECT }
    );

    // Another series sorts first, so the known instance falls into cluster 1.
    const result = await importFiles(P1, [
      ['A/IM2', { instance: 2, seriesDescription: 'OTHER', attributes: { SeriesInstanceUID: SERIES_B } }],
      ['B/IM1', { instance: 1 }],
    ]);

    expect(result).toMatchObject({ importedImages: 1, alreadyImported: 1 });
    expect(
      await count('patients_images', `"sopInstanceUid" = '${sopOf(1)}' AND "clusterId" = '${clusterId}'`)
    ).toBe(1);
    expect(await count('patients_images', `"sopInstanceUid" = '${sopOf(1)}'`)).toBe(1);
  });

  it('deduplicates broken images like the others', async () => {
    // An archive needs at least one usable image (existing rule).
    const broken: SyntheticDicomOptions = { instance: 9, pixelDataBytes: 4 };
    await importFiles(P1, [['IM9', broken], ['IM1', { instance: 1 }]]);
    const second = await importFiles(P1, [
      ['COPY_OF_IM9', broken],
      ['COPY_OF_IM1', { instance: 1 }],
    ]);

    expect(second).toMatchObject({ importedImages: 0, alreadyImported: 2, brokenImages: 1 });
    expect(await count('patients_images', `"isBrocken"`)).toBe(1);
    expect(await count('patients_images')).toBe(2);
  });

  it('keeps one of two identical files inside one archive', async () => {
    const result = await importFiles(P1, [
      ['A/IM1', { instance: 1 }],
      ['B/IM1_COPY', { instance: 1 }],
    ]);

    expect(result).toMatchObject({ importedImages: 1, alreadyImported: 1 });
    expect(await count('patients_images')).toBe(1);
    expect(await storedFiles()).toHaveLength(1);
  });

  it('imports an image whose hash is stored under another SOP UID, with a warning', async () => {
    await importFiles(P1, [['IM1', { instance: 1 }]]);
    // Legacy inconsistency: the stored row claims another SOP UID.
    await sequelize.query(
      `UPDATE patients_images SET "sopInstanceUid" = '2.25.999', "seriesId" = NULL`
    );

    const result = await importFiles(P1, [['IM1_AGAIN', { instance: 1 }]]);

    expect(result).toMatchObject({ importedImages: 1 });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { patientId: P1, storedImageIds: [expect.any(String)] },
      expect.stringContaining('possible_duplicate_content')
    );
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toMatch(/2\.25\./);
  });

  // --- Conflicts: whole archive rejected, nothing left ---------------------------

  it('same SOP UID with other content: rejected with a full rollback, no orphaned file', async () => {
    await importFiles(P1, [['IM1', { instance: 1 }]]);
    const before = await snapshot();

    // Together with a new instance and a new series: nothing of it may stay.
    await expect(
      importFiles(P1, [
        ['IM1', otherContent(1)],
        ['IM5', { instance: 5, attributes: { SeriesInstanceUID: SERIES_B } }],
      ])
    ).rejects.toMatchObject({ name: 'ArchiveError', code: 'SOP_INSTANCE_CONTENT_CONFLICT' });

    expect(await snapshot()).toEqual(before);
  });

  it('rejects an instance stored without a hash (content cannot be proven equal)', async () => {
    await importFiles(P1, [['IM1', { instance: 1 }]]);
    await sequelize.query(`UPDATE patients_images SET "fileSha256" = NULL`);

    await expect(importFiles(P1, [['IM1', { instance: 1 }]])).rejects.toMatchObject({
      code: 'SOP_INSTANCE_CONTENT_CONFLICT',
    });
  });

  it('rejects an instance stored for another patient', async () => {
    await importFiles(P1, [['IM1', { instance: 1 }]]);
    const before = await snapshot();

    // Other study and series UIDs, so that only the instance collides.
    await expect(
      importFiles(P2, [
        ['IM1', { instance: 1, attributes: { StudyInstanceUID: STUDY_B, SeriesInstanceUID: SERIES_B } }],
      ])
    ).rejects.toMatchObject({ code: 'SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT' });

    expect(await snapshot()).toEqual(before);
  });

  it('rejects an instance stored in another series of the same study', async () => {
    await importFiles(P1, [['IM1', { instance: 1 }]]);
    const before = await snapshot();

    await expect(
      importFiles(P1, [['IM1', { instance: 1, attributes: { SeriesInstanceUID: SERIES_B } }]])
    ).rejects.toMatchObject({ code: 'SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES' });

    // Also the series created for this import is gone.
    expect(await snapshot()).toEqual(before);
  });

  it('removes files already placed when the import fails later (no orphaned files)', async () => {
    await importFiles(P1, [['IM1', { instance: 1 }]]);
    const before = await snapshot();
    const { PatientImage } = require('../db/models/PatientImage.model');
    const bulkCreate = jest
      .spyOn(PatientImage, 'bulkCreate')
      .mockRejectedValueOnce(new Error('db insert failed'));

    await expect(
      importFiles(P1, [['IM2', { instance: 2 }], ['IM3', { instance: 3 }]])
    ).rejects.toThrow('db insert failed');
    bulkCreate.mockRestore();

    expect(await snapshot()).toEqual(before);
  });

  // --- Concurrency ---------------------------------------------------------------

  it('concurrent identical imports store each instance once', async () => {
    const archive: [string, SyntheticDicomOptions][] = [
      ['IM1', { instance: 1 }],
      ['IM2', { instance: 2 }],
    ];

    const results = await Promise.all([
      importFiles(P1, archive),
      importFiles(P1, archive.map(([name, o]) => [`renamed-${name}`, o])),
    ]);

    expect(results.map(({ importedImages }) => importedImages).sort()).toEqual([0, 2]);
    expect(results.map(({ alreadyImported }) => alreadyImported).sort()).toEqual([0, 2]);
    expect(await count('patients_images')).toBe(2);
    expect(await storedFiles()).toHaveLength(2);
  });

  it('concurrent imports of one SOP UID with different content: one wins, one is rolled back', async () => {
    const results = await Promise.allSettled([
      importFiles(P1, [['IM1', { instance: 1 }]]),
      importFiles(P1, [['IM1', otherContent(1)]]),
    ]);

    const rejected = results.filter(({ status }) => status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'SOP_INSTANCE_CONTENT_CONFLICT' });
    expect(await count('patients_images')).toBe(1);
    expect(await storedFiles()).toHaveLength(1);
  });
});
