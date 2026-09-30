/**
 * DICOM metadata backfill against a real PostgreSQL database and synthetic
 * DICOM files in a temporary upload root.
 *
 * Runs only when TEST_DATABASE_URL is set. It uses its own database,
 * "<name of TEST_DATABASE_URL>_backfill" (created when missing), so that it
 * can run in parallel with the migration tests; every test recreates its
 * `public` schema.
 */
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize } from 'sequelize';
import { makeSyntheticDicom } from '../../services/archive/__fixtures__/synthetic';
import type * as BackfillModule from './dicom-metadata.backfill';
import type * as MigratorModule from '../migrator';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL backfill tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const HMAC_KEY = 'synthetic-test-key-synthetic-test-key';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const imageId = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The metadata columns of one row, as read back. */
const METADATA_SQL = `"studyInstanceUid", "seriesInstanceUid", "sopInstanceUid",
  "sopClassUid", modality, "imageType", "seriesNumber", "instanceNumber",
  "frameOfReferenceUid", "seriesDescription", "convolutionKernel",
  "imagePositionPatient", "imageOrientationPatient", "slicePosition", rows,
  columns, "pixelSpacing", "sliceThickness", "rescaleSlope",
  "rescaleIntercept", "photometricInterpretation", "bitsStored",
  "pixelRepresentation", "numberOfFrames", "transferSyntaxUid", "fileSha256",
  "fileSize"`;

describeWithDatabase('DICOM metadata backfill (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let backfill: typeof BackfillModule;
  let migrator: typeof MigratorModule;
  let tmp: string;
  let uploadRoot: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_backfill`;
    if (!/test/i.test(database)) {
      throw new Error(`TEST_DATABASE_URL must name a test database (got "${database}").`);
    }
    if (url.port && url.port !== '5432') {
      throw new Error('TEST_DATABASE_URL must use port 5432 (DB_* has no port).');
    }
    const admin = new Sequelize(databaseUrl as string, { logging: false });
    const exists = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      { bind: [database], type: QueryTypes.SELECT }
    );
    if (!exists.length) await admin.query(`CREATE DATABASE "${database}"`);
    await admin.close();

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-backfill-'));
    uploadRoot = path.join(tmp, 'uploads');
    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;
    ({ sequelize } = require('../sequelize'));
    backfill = require('./dicom-metadata.backfill');
    migrator = require('../migrator');
  });

  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    // A database before the unique SOP index: the backfill runs first there
    // (legacy duplicates possible). With the index: sop-unique spec.
    await migrator.migrateUp(sequelize, undefined, {
      to: '202609301200-patient-image-instance-indexes',
    });
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Fixtures ---------------------------------------------------------------

  const addPatient = (id: string, trashed = false) =>
    sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt", "deletedAt")
       VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now(), ${trashed ? 'now()' : 'NULL'})`,
      { bind: [id, `synthetic-${id.slice(0, 4)}`] }
    );
  const addCluster = (id: string, patientId: string) =>
    sequelize.query(
      `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
       VALUES ($1, 'SYNTHETIC', 0, $2, now(), now())`,
      { bind: [id, patientId] }
    );

  const UPDATED_AT = '2020-01-01T00:00:00.000Z';

  /** An image row as imported before PR2 (no metadata) plus its file. */
  const addImage = async ({
    n,
    patientId = P1,
    clusterId = C1,
    bytes = makeSyntheticDicom({ instance: n, sliceZ: n * 2.5 }),
    file = `IM${n}`,
    source = `/uploads/${patientId}/${clusterId}/${file}`,
    broken = false,
    metadata = {},
  }: {
    n: number;
    patientId?: string;
    clusterId?: string;
    bytes?: Buffer | null;
    file?: string;
    source?: string;
    broken?: boolean;
    metadata?: Record<string, unknown>;
  }) => {
    if (bytes) {
      const dir = path.join(uploadRoot, patientId, clusterId);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, file), bytes);
    }
    const columns = Object.keys(metadata).map((c) => `"${c}"`);
    const values = Object.values(metadata);
    await sequelize.query(
      `INSERT INTO patients_images (id, source, "clusterId", details, "isBrocken", status,
         "votesCount", "abnormalVotes", "createdAt", "updatedAt"${columns.map((c) => `, ${c}`).join('')})
       VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $7${values.map((_, i) => `, $${i + 8}`).join('')})`,
      {
        bind: [
          imageId(n),
          source,
          clusterId,
          broken
            ? null
            : JSON.stringify({ normal: [0, 0, 1], geometry: {}, outliers: [] }),
          broken,
          broken ? 'broken' : 'abnormal',
          UPDATED_AT,
          ...values,
        ],
      }
    );
    return bytes;
  };

  const readRow = async (n: number) => {
    const [row] = await sequelize.query<Record<string, unknown>>(
      `SELECT ${METADATA_SQL}, status, "isBrocken", "votesCount", "abnormalVotes",
              "updatedAt", details
       FROM patients_images WHERE id = $1`,
      { bind: [imageId(n)], type: QueryTypes.SELECT }
    );
    return row;
  };
  const readMetadata = async (n: number) => {
    const [row] = await sequelize.query<Record<string, unknown>>(
      `SELECT ${METADATA_SQL} FROM patients_images WHERE id = $1`,
      { bind: [imageId(n)], type: QueryTypes.SELECT }
    );
    return row;
  };
  const allMetadataNull = (row: Record<string, unknown>) =>
    Object.values(row).every((value) => value === null);

  const run = (options: Partial<BackfillModule.BackfillOptions> = {}) =>
    backfill.runDicomMetadataBackfill(sequelize, {
      apply: false,
      batchSize: 200,
      includeTrashed: false,
      rescan: false,
      uploadRoot,
      hmacKey: HMAC_KEY,
      ...options,
    });
  const rowResult = (report: BackfillModule.BackfillReport, n: number) =>
    report.rows.find(({ imageId: id }) => id === imageId(n));

  const withPatients = async () => {
    await addPatient(P1);
    await addCluster(C1, P1);
  };

  // --- Tests -------------------------------------------------------------------

  it('dry-run reports what would change and writes nothing', async () => {
    await withPatients();
    await addImage({ n: 1 });

    const report = await run();

    expect(report.run.mode).toBe('dry-run');
    expect(rowResult(report, 1)).toMatchObject({ result: 'would_update' });
    expect(rowResult(report, 1)?.filled).toContain('sopInstanceUid');
    expect(allMetadataNull(await readMetadata(1))).toBe(true);
    expect((await readRow(1)).updatedAt).toEqual(new Date(UPDATED_AT));
  });

  it('apply fills the NULL metadata from the file, keeping review data and updatedAt', async () => {
    await withPatients();
    const bytes = (await addImage({ n: 3 })) as Buffer;

    const report = await run({ apply: true });

    expect(rowResult(report, 3)).toMatchObject({ result: 'updated' });
    const row = await readRow(3);
    expect(row).toMatchObject({
      sopInstanceUid: '2.25.10000000000000000000000003',
      studyInstanceUid: expect.stringMatching(/^2\.25\./),
      seriesInstanceUid: expect.stringMatching(/^2\.25\./),
      modality: 'CT',
      imagePositionPatient: [0, 0, 7.5],
      // IPP . details.normal, as the import computes it.
      slicePosition: 7.5,
      rescaleSlope: 1,
      rescaleIntercept: -1024,
      transferSyntaxUid: '1.2.840.10008.1.2.1',
      fileSha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
      fileSize: String(bytes.length),
      numberOfFrames: null,
      // Unchanged:
      status: 'abnormal',
      isBrocken: false,
      votesCount: 1,
      abnormalVotes: 1,
      updatedAt: new Date(UPDATED_AT),
    });
  });

  it('leaves equal stored values alone and fills only the missing ones', async () => {
    await withPatients();
    await addImage({
      n: 1,
      metadata: { sopInstanceUid: '2.25.10000000000000000000000001', modality: 'CT' },
    });

    const report = await run({ apply: true });

    expect(rowResult(report, 1)?.result).toBe('updated');
    expect(rowResult(report, 1)?.filled).not.toContain('sopInstanceUid');
    expect(rowResult(report, 1)?.filled).not.toContain('modality');
    expect(await readMetadata(1)).toMatchObject({
      sopInstanceUid: '2.25.10000000000000000000000001',
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('gives a conflicting row no update at all (no partial metadata)', async () => {
    await withPatients();
    // The stored SOP UID differs from the file; everything else is NULL.
    await addImage({ n: 1, metadata: { sopInstanceUid: '2.25.999' } });
    await addImage({ n: 2 });
    const before = await readRow(1);

    const report = await run({ apply: true });

    expect(rowResult(report, 1)).toEqual({
      imageId: imageId(1),
      patientId: P1,
      result: 'metadata_conflict',
      filled: [],
      conflicts: ['sopInstanceUid'],
      flags: [],
    });
    // Byte-for-byte the same row: not one of the NULL columns was filled.
    expect(await readRow(1)).toEqual(before);
    const after = await readMetadata(1);
    expect(Object.entries(after).filter(([, v]) => v !== null)).toEqual([
      ['sopInstanceUid', '2.25.999'],
    ]);
    // Other rows are still processed.
    expect(rowResult(report, 2)?.result).toBe('updated');
    expect(JSON.stringify(report)).not.toContain('2.25.999');
  });

  it('reports a missing file and leaves its row unchanged', async () => {
    await withPatients();
    await addImage({ n: 1, bytes: null });

    const report = await run({ apply: true });

    expect(rowResult(report, 1)?.result).toBe('missing_file');
    expect(allMetadataNull(await readMetadata(1))).toBe(true);
  });

  it('rejects a stored source outside the upload root', async () => {
    await withPatients();
    await writeFile(path.join(tmp, 'outside.dcm'), makeSyntheticDicom());
    await addImage({ n: 1, bytes: null, source: '/uploads/../outside.dcm' });

    const report = await run({ apply: true });

    expect(rowResult(report, 1)?.result).toBe('unsafe_path');
    expect(allMetadataNull(await readMetadata(1))).toBe(true);
  });

  it('rejects a symlink that escapes the upload root', async () => {
    await withPatients();
    await mkdir(path.join(tmp, 'outside-dir'), { recursive: true });
    await writeFile(path.join(tmp, 'outside-dir', 'IM1'), makeSyntheticDicom());
    await mkdir(path.join(uploadRoot, P1), { recursive: true });
    await symlink(path.join(tmp, 'outside-dir'), path.join(uploadRoot, P1, C1), 'junction');
    await addImage({ n: 1, bytes: null });

    const report = await run({ apply: true });

    expect(rowResult(report, 1)?.result).toBe('unsafe_path');
    expect(allMetadataNull(await readMetadata(1))).toBe(true);
    await rm(path.join(uploadRoot, P1, C1), { force: true, recursive: true });
  });

  it('a file that cannot be parsed affects only its row', async () => {
    await withPatients();
    await addImage({ n: 1, bytes: Buffer.from('not a DICOM file') });
    await addImage({ n: 2 });

    const report = await run({ apply: true });

    expect(rowResult(report, 1)?.result).toBe('parse_failed');
    expect(allMetadataNull(await readMetadata(1))).toBe(true);
    expect(rowResult(report, 2)?.result).toBe('updated');
  });

  it('fills the metadata of a broken image without changing its status', async () => {
    await withPatients();
    await addImage({
      n: 1,
      broken: true,
      bytes: makeSyntheticDicom({ instance: 1, pixelDataBytes: 4 }),
    });

    const report = await run({ apply: true });

    expect(rowResult(report, 1)).toMatchObject({ result: 'updated', flags: [] });
    expect(await readRow(1)).toMatchObject({
      sopInstanceUid: expect.any(String),
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      slicePosition: null,
      status: 'broken',
      isBrocken: true,
    });
  });

  it('flags missing and invalid UIDs', async () => {
    await withPatients();
    await addImage({
      n: 1,
      bytes: makeSyntheticDicom({
        instance: 1,
        attributes: { StudyInstanceUID: null, SeriesInstanceUID: '1.2.X' },
      }),
    });

    const report = await run();

    expect(rowResult(report, 1)?.flags).toEqual([
      'missing_study_uid',
      'missing_series_uid',
      'invalid_uid:seriesInstanceUid',
    ]);
    expect(report.summary).toMatchObject({ missingStudyUid: 1, invalidUid: 1 });
  });

  describe('duplicates and patient leakage', () => {
    beforeEach(async () => {
      await addPatient(P1);
      await addCluster(C1, P1);
      await addPatient(P2);
      await addCluster(C2, P2);
    });

    it('reports a duplicate SOP Instance UID with the same file', async () => {
      const bytes = makeSyntheticDicom({ instance: 1 });
      await addImage({ n: 1, bytes });
      await addImage({ n: 2, bytes, file: 'COPY' });

      const { groups } = await run();

      expect(groups.duplicateSopInstanceUid).toEqual([
        expect.objectContaining({
          imageIds: [imageId(1), imageId(2)],
          differentFileHashes: false,
        }),
      ]);
      expect(groups.duplicateFileHash).toHaveLength(1);
    });

    it('reports the same SOP Instance UID with different files', async () => {
      await addImage({ n: 1, bytes: makeSyntheticDicom({ instance: 1 }) });
      await addImage({
        n: 2,
        file: 'OTHER',
        bytes: makeSyntheticDicom({ instance: 1, rows: 8, cols: 8 }),
      });

      const { groups } = await run();

      expect(groups.duplicateSopInstanceUid).toEqual([
        expect.objectContaining({ differentFileHashes: true }),
      ]);
      expect(groups.duplicateFileHash).toEqual([]);
    });

    it('reports the same study, SOP instance and file under different patients', async () => {
      const bytes = makeSyntheticDicom({ instance: 1 });
      await addImage({ n: 1, bytes });
      await addImage({ n: 2, bytes, patientId: P2, clusterId: C2 });

      const report = await run();

      const leak = expect.objectContaining({
        imageIds: [imageId(1), imageId(2)],
        patientIds: [P1, P2],
      });
      expect(report.groups.studyUidAcrossPatients).toEqual([leak]);
      expect(report.groups.sopUidAcrossPatients).toEqual([leak]);
      expect(report.groups.fileHashAcrossPatients).toEqual([leak]);
      expect(report.summary).toMatchObject({
        studyUidAcrossPatientsGroups: 1,
        fileHashAcrossPatientsGroups: 1,
      });
    });

    it('reports rows that share one stored file (hard link)', async () => {
      await addImage({ n: 1 });
      // The import places files as hard links; two names, one file.
      await link(
        path.join(uploadRoot, P1, C1, 'IM1'),
        path.join(uploadRoot, P1, C1, 'IM1_LINK')
      );
      await addImage({ n: 2, bytes: null, file: 'IM1_LINK' });

      const { groups } = await run();

      expect(groups.sameStoredFile).toEqual([
        expect.objectContaining({ imageIds: [imageId(1), imageId(2)] }),
      ]);
    });

    it('uses group keys that are stable between runs', async () => {
      const bytes = makeSyntheticDicom({ instance: 1 });
      await addImage({ n: 1, bytes });
      await addImage({ n: 2, bytes, patientId: P2, clusterId: C2 });

      const first = await run();
      const second = await run();

      expect(second.groups.studyUidAcrossPatients[0].key).toBe(
        first.groups.studyUidAcrossPatients[0].key
      );
    });
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    await withPatients();
    for (const n of [1, 2, 3]) await addImage({ n });
    await run({ apply: true });
    const snapshot = await Promise.all([1, 2, 3].map(readRow));

    const again = await run({ apply: true });
    const audit = await run({ apply: true, rescan: true });

    expect(again.summary).toMatchObject({ scanned: 0, updated: 0 });
    expect(audit.summary).toMatchObject({ scanned: 3, updated: 0, alreadyComplete: 3 });
    expect(await Promise.all([1, 2, 3].map(readRow))).toEqual(snapshot);
  });

  it('processes every row exactly once across batches', async () => {
    await withPatients();
    for (let n = 1; n <= 7; n++) await addImage({ n });

    const report = await run({ apply: true, batchSize: 2 });

    const ids = report.rows.map(({ imageId: id }) => id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7].map(imageId));
    expect(report.summary).toMatchObject({ scanned: 7, updated: 7 });
  });

  it('skips images of trashed patients unless asked, never restoring them', async () => {
    await addPatient(P1, true);
    await addCluster(C1, P1);
    await addImage({ n: 1 });

    const skipped = await run({ apply: true });
    expect(rowResult(skipped, 1)?.result).toBe('skipped_trashed_patient');
    expect(allMetadataNull(await readMetadata(1))).toBe(true);

    const included = await run({ apply: true, includeTrashed: true });
    expect(rowResult(included, 1)?.result).toBe('updated');
    const [patient] = await sequelize.query<{ deletedAt: Date | null }>(
      'SELECT "deletedAt" FROM patients WHERE id = $1',
      { bind: [P1], type: QueryTypes.SELECT }
    );
    expect(patient.deletedAt).not.toBeNull();
  });

  it('writes no paths, file names, UIDs, hashes or free text into the report', async () => {
    await withPatients();
    const bytes = (await addImage({
      n: 1,
      file: 'Doe_John_CT.dcm',
      bytes: makeSyntheticDicom({ instance: 1, seriesDescription: 'FREE TEXT' }),
    })) as Buffer;

    const serialized = JSON.stringify(await run({ apply: true }));

    for (const secret of [
      uploadRoot,
      JSON.stringify(uploadRoot).slice(1, -1),
      'Doe_John_CT',
      'FREE TEXT',
      '2.25.',
      require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  describe('preconditions (nothing is written when they fail)', () => {
    it('refuses to run before the metadata migration is applied', async () => {
      await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      const { migrations } = require('../migrations');
      await migrator.migrateUp(sequelize, migrations.slice(0, 1));

      await expect(run({ apply: true })).rejects.toThrow(
        /Pending database migrations: 202609281200-patient-image-dicom-metadata/
      );
    });

    it('refuses an invalid upload root', async () => {
      await expect(
        run({ apply: true, uploadRoot: path.join(tmp, 'does-not-exist') })
      ).rejects.toThrow(backfill.BackfillPreconditionError);
    });

    it('refuses a missing report HMAC key', async () => {
      await expect(run({ hmacKey: '' })).rejects.toThrow(/REPORT_HMAC_KEY/);
    });
  });

  it('keeps an update away from a row that changed after it was read', async () => {
    await withPatients();
    await addImage({ n: 1 });
    // Another process fills a column between the scan and the write.
    let changed = false;
    const originalTransaction = sequelize.transaction.bind(sequelize);
    const spy = jest
      .spyOn(sequelize, 'transaction')
      .mockImplementation((async (...args: unknown[]) => {
        if (!changed) {
          changed = true;
          await sequelize.query(
            `UPDATE patients_images SET modality = 'MR' WHERE id = $1`,
            { bind: [imageId(1)] }
          );
        }
        return (originalTransaction as (...a: unknown[]) => unknown)(...args);
      }) as never);

    const report = await run({ apply: true });
    spy.mockRestore();

    expect(rowResult(report, 1)).toMatchObject({
      result: 'changed_during_run',
      filled: [],
    });
    const after = await readMetadata(1);
    expect(Object.entries(after).filter(([, v]) => v !== null)).toEqual([
      ['modality', 'MR'],
    ]);
  });

  it('tells a copy (same content, other file) from a shared file', async () => {
    await withPatients();
    await addImage({ n: 1 });
    await copyFile(
      path.join(uploadRoot, P1, C1, 'IM1'),
      path.join(uploadRoot, P1, C1, 'IM1_COPY')
    );
    await addImage({ n: 2, bytes: null, file: 'IM1_COPY' });

    const { groups } = await run();

    // A copy is a different stored file with the same content.
    expect(groups.sameStoredFile).toEqual([]);
    expect(groups.duplicateFileHash).toHaveLength(1);
  });
});
