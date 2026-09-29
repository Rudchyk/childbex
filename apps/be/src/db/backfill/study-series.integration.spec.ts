/**
 * DICOM Study / Series against a real PostgreSQL database: the migration,
 * the hierarchy created by real archive imports, `backfill study-series`
 * and concurrency.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_hierarchy" (created when missing); every test
 * recreates its `public` schema.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize, type Transaction } from 'sequelize';
import {
  buildTar,
  makeSyntheticDicom,
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
  type SyntheticDicomOptions,
} from '../../services/archive/__fixtures__/synthetic';
import type * as MigratorModule from '../migrator';
import type * as StudySeriesModule from './study-series.backfill';
import type * as HierarchyModule from '../../services/dicom-hierarchy.service';
import type * as PatientsServiceModule from '../../services/patients.service';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL Study/Series tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const HMAC_KEY = 'synthetic-test-key-synthetic-test-key';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const STUDY_B = '2.25.200000000000000000000000002';
const SERIES_B = '2.25.300000000000000000000000002';
const imageId = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describeWithDatabase('DICOM Study / Series (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let backfill: typeof StudySeriesModule;
  let hierarchy: typeof HierarchyModule;
  let importPatientArchiveFile: typeof PatientsServiceModule.importPatientArchiveFile;
  let tmp: string;
  let uploadRoot: string;
  let archiveCount = 0;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_hierarchy`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-hierarchy-'));
    uploadRoot = path.join(tmp, 'uploads');
    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.ARCHIVES_ROOT = path.join(tmp, 'archives');
    process.env.ARCHIVE_WORK_DIR = path.join(tmp, 'work');
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    // patients.service first: it and the models import each other.
    ({ importPatientArchiveFile } = require('../../services/patients.service'));
    ({ sequelize } = require('../sequelize'));
    migrator = require('../migrator');
    backfill = require('./study-series.backfill');
    hierarchy = require('../../services/dicom-hierarchy.service');
  });

  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    await migrator.migrateUp(sequelize);
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Helpers -----------------------------------------------------------------

  const { migrations } = require('../migrations') as typeof import('../migrations');
  /** The migrations up to Study/Series (later ones build on it). */
  const upToStudySeries = () =>
    migrations.slice(
      0,
      migrations.findIndex(({ name }) => name === '202609291200-study-series') + 1
    );

  const count = async (table: string, where = 'TRUE') => {
    const [row] = await sequelize.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
      { type: QueryTypes.SELECT }
    );
    return Number(row.n);
  };

  const addPatient = (id: string, trashed = false) =>
    sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt", "deletedAt")
       VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now(), ${trashed ? 'now()' : 'NULL'})`,
      { bind: [id, `synthetic-${id.slice(0, 4)}`] }
    );

  /**
   * A real archive import (extraction, parsing, one DB transaction). File
   * names are unique per archive: the import skips a file whose name already
   * exists in the cluster (existing behavior, keyed by path).
   */
  const importSlices = async (patientId: string, slices: SyntheticDicomOptions[]) => {
    // Taken before the first await: concurrent calls get their own numbers.
    const number = ++archiveCount;
    const bytes = await buildTar(
      slices.map((options, i) => ({
        name: `DICOM/A${number}-IM${i}`,
        data: makeSyntheticDicom(options),
      }))
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

  const seriesB = (instance: number): SyntheticDicomOptions => ({
    instance,
    attributes: { SeriesInstanceUID: SERIES_B },
  });

  // --- Migration ---------------------------------------------------------------

  describe('migration 202609291200-study-series', () => {
    it('creates studies, series and a nullable, indexed seriesId', async () => {
      const schema = await migrator.readActualSchema(sequelize);

      expect(schema.columns.studies).toMatchObject({
        id: { type: 'uuid', nullable: false },
        patientId: { type: 'uuid', nullable: false },
        studyInstanceUid: { type: 'varchar', nullable: false },
        studyDate: { type: 'date', nullable: true },
        studyTime: { type: 'varchar', nullable: true },
      });
      expect(schema.columns.series).toMatchObject({
        studyId: { type: 'uuid', nullable: false },
        seriesInstanceUid: { type: 'varchar', nullable: false },
        imageType: { type: '_text', nullable: true },
        sliceThickness: { type: 'float8', nullable: true },
      });
      expect(schema.columns.patients_images.seriesId).toEqual({
        type: 'uuid',
        nullable: true,
      });
      expect(schema.uniqueIndexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: 'studies', columns: ['studyInstanceUid'] }),
          expect.objectContaining({ table: 'series', columns: ['seriesInstanceUid'] }),
        ])
      );
      expect(schema.foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ table: 'studies', references: 'patients', onDelete: 'CASCADE' }),
          expect.objectContaining({ table: 'series', references: 'studies', onDelete: 'CASCADE' }),
          expect.objectContaining({
            table: 'patients_images',
            columns: ['seriesId'],
            references: 'series',
            onDelete: 'NO ACTION',
          }),
        ])
      );
      const indexes = await sequelize.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
           AND indexname IN ('studies_patient_id', 'series_study_id', 'patients_images_series_id')`,
        { type: QueryTypes.SELECT }
      );
      expect(indexes).toHaveLength(3);
    });

    it('can be rolled back and applied again', async () => {
      // Later migrations first, then this one.
      const later = migrations.length - upToStudySeries().length;
      for (let i = 0; i < later; i++) await migrator.migrateDown(sequelize);

      const reverted = await migrator.migrateDown(sequelize, upToStudySeries());

      expect(reverted.map(({ name }) => name)).toEqual(['202609291200-study-series']);
      const { columns } = await migrator.readActualSchema(sequelize);
      expect(columns.studies).toBeUndefined();
      expect(columns.series).toBeUndefined();
      expect(columns.patients_images).not.toHaveProperty('seriesId');
      expect(await migrator.migrateUp(sequelize)).toHaveLength(later + 1);
    });
  });

  // --- New imports -------------------------------------------------------------

  describe('import', () => {
    beforeEach(() => addPatient(P1));

    it('creates one study and one series for one UID each, and links every image', async () => {
      const result = await importSlices(P1, [{ instance: 1 }, { instance: 2 }]);

      expect(result).toMatchObject({ importedImages: 2 });
      const [study] = await sequelize.query<Record<string, unknown>>(
        `SELECT "patientId", "studyInstanceUid", "studyDate"::text AS "studyDate", "studyTime" FROM studies`,
        { type: QueryTypes.SELECT }
      );
      expect(study).toEqual({
        patientId: P1,
        studyInstanceUid: SYNTHETIC_STUDY_UID,
        studyDate: '2020-01-01',
        studyTime: '120000',
      });
      const series = await sequelize.query<Record<string, unknown>>(
        `SELECT id, "seriesInstanceUid", modality, "imageType", "sliceThickness" FROM series`,
        { type: QueryTypes.SELECT }
      );
      expect(series).toEqual([
        {
          id: expect.any(String),
          seriesInstanceUid: SYNTHETIC_SERIES_UID,
          modality: 'CT',
          imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
          sliceThickness: 1.25,
        },
      ]);
      expect(await count('patients_images', `"seriesId" = '${series[0].id}'`)).toBe(2);
      // The clusters work as before.
      expect(await count('patient_images_clusters')).toBe(1);
      expect(await count('patients_images', '"clusterId" IS NOT NULL')).toBe(2);
    });

    it('creates one series per Series UID under one study', async () => {
      await importSlices(P1, [{ instance: 1 }, seriesB(2), seriesB(3)]);

      expect(await count('studies')).toBe(1);
      expect(await count('series')).toBe(2);
      const perSeries = await sequelize.query<{ n: string }>(
        `SELECT count(*) AS n FROM patients_images GROUP BY "seriesId" ORDER BY n`,
        { type: QueryTypes.SELECT }
      );
      expect(perSeries.map(({ n }) => Number(n))).toEqual([1, 2]);
    });

    it('reuses the study and series when more of them is imported later', async () => {
      await importSlices(P1, [{ instance: 1 }]);
      await importSlices(P1, [{ instance: 2 }, seriesB(3)]);

      expect(await count('studies')).toBe(1);
      expect(await count('series')).toBe(2);
      expect(await count('patients_images')).toBe(3);
      expect(await count('patients_images', '"seriesId" IS NOT NULL')).toBe(3);
    });

    it('leaves series values the images disagree on empty', async () => {
      await importSlices(P1, [
        { instance: 1 },
        { instance: 2, attributes: { SliceThickness: '5' } },
      ]);

      const [series] = await sequelize.query<Record<string, unknown>>(
        `SELECT "sliceThickness", modality FROM series`,
        { type: QueryTypes.SELECT }
      );
      expect(series).toEqual({ sliceThickness: null, modality: 'CT' });
    });

    it('rejects a study stored for another patient and rolls everything back', async () => {
      await addPatient(P2);
      await importSlices(P1, [{ instance: 1 }]);
      const before = {
        studies: await count('studies'),
        series: await count('series'),
        images: await count('patients_images'),
        clusters: await count('patient_images_clusters'),
      };

      // Same Study UID, another patient, another (new) series.
      await expect(importSlices(P2, [seriesB(2)])).rejects.toMatchObject({
        name: 'ArchiveError',
        code: 'STUDY_BELONGS_TO_ANOTHER_PATIENT',
      });

      expect({
        studies: await count('studies'),
        series: await count('series'),
        images: await count('patients_images'),
        clusters: await count('patient_images_clusters'),
      }).toEqual(before);
      const [study] = await sequelize.query<{ patientId: string }>(
        `SELECT "patientId" FROM studies`,
        { type: QueryTypes.SELECT }
      );
      expect(study.patientId).toBe(P1);
    });

    it('rejects a series that belongs to another study, without leftovers', async () => {
      await importSlices(P1, [{ instance: 1 }]);

      // Same Series UID under a new Study UID: the new study must not stay.
      await expect(
        importSlices(P1, [{ instance: 2, attributes: { StudyInstanceUID: STUDY_B } }])
      ).rejects.toMatchObject({ code: 'SERIES_BELONGS_TO_ANOTHER_STUDY' });

      expect(await count('studies')).toBe(1);
      expect(await count('studies', `"studyInstanceUid" = '${STUDY_B}'`)).toBe(0);
      expect(await count('patients_images')).toBe(1);
    });

    it('removes a new study and series when the import fails later', async () => {
      const { PatientImage } = require('../models/PatientImage.model');
      const bulkCreate = jest
        .spyOn(PatientImage, 'bulkCreate')
        .mockRejectedValueOnce(new Error('db insert failed'));

      await expect(importSlices(P1, [{ instance: 1 }])).rejects.toThrow('db insert failed');
      bulkCreate.mockRestore();

      expect(await count('studies')).toBe(0);
      expect(await count('series')).toBe(0);
      expect(await count('patient_images_clusters')).toBe(0);
    });

    it('creates the hierarchy once for concurrent imports of one study', async () => {
      const results = await Promise.all([
        importSlices(P1, [{ instance: 1 }, { instance: 2 }]),
        importSlices(P1, [{ instance: 1 }, { instance: 2 }]),
      ]);

      // Both succeed; the instances are stored once (deduplication).
      expect(results.map(({ importedImages }) => importedImages).sort()).toEqual([0, 2]);
      expect(await count('studies')).toBe(1);
      expect(await count('series')).toBe(1);
      expect(await count('patients_images')).toBe(2);
      expect(await count('patients_images', '"seriesId" IS NULL')).toBe(0);
    });
  });

  // --- Concurrency of the building blocks --------------------------------------

  describe('concurrent creation', () => {
    beforeEach(async () => {
      await addPatient(P1);
      await addPatient(P2);
    });

    const inTransaction = <T>(work: (t: Transaction) => Promise<T>) =>
      sequelize.transaction(work);
    const study = (patientId: string) => ({
      patientId,
      studyInstanceUid: SYNTHETIC_STUDY_UID,
      studyDate: null,
      studyTime: null,
    });

    it('gives parallel transactions one study and one series row', async () => {
      const create = () =>
        inTransaction(async (transaction) => {
          const s = await hierarchy.ensureStudy(sequelize, study(P1), transaction);
          const series = await hierarchy.ensureSeries(
            sequelize,
            {
              studyId: s.id,
              seriesInstanceUid: SYNTHETIC_SERIES_UID,
              seriesNumber: null,
              seriesDescription: null,
              modality: 'CT',
              imageType: null,
              frameOfReferenceUid: null,
              convolutionKernel: null,
              sliceThickness: null,
            },
            transaction
          );
          // Hold the transaction open while the others run.
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { studyId: s.id, seriesId: series.id, created: s.created };
        });

      const results = await Promise.all([create(), create(), create()]);

      expect(new Set(results.map(({ studyId }) => studyId)).size).toBe(1);
      expect(new Set(results.map(({ seriesId }) => seriesId)).size).toBe(1);
      expect(results.filter(({ created }) => created)).toHaveLength(1);
      expect(await count('studies')).toBe(1);
      expect(await count('series')).toBe(1);
    });

    it('lets only one patient own a study UID created concurrently', async () => {
      const results = await Promise.allSettled(
        [P1, P2].map((patientId) =>
          inTransaction(async (transaction) => {
            const s = await hierarchy.ensureStudy(sequelize, study(patientId), transaction);
            await new Promise((resolve) => setTimeout(resolve, 50));
            return s;
          })
        )
      );

      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find(({ status }) => status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(hierarchy.HierarchyConflictError);
      expect(await count('studies')).toBe(1);
    });
  });

  // --- Linking existing images -------------------------------------------------

  describe('backfill study-series', () => {
    /** An image imported before Study/Series, with its metadata backfilled. */
    const addImage = async ({
      n,
      patientId = P1,
      clusterId = C1,
      study = SYNTHETIC_STUDY_UID as string | null,
      series = SYNTHETIC_SERIES_UID as string | null,
      verified = true,
      file = true,
    }: {
      n: number;
      patientId?: string;
      clusterId?: string;
      study?: string | null;
      series?: string | null;
      verified?: boolean;
      file?: boolean;
    }) => {
      if (file) {
        const dir = path.join(uploadRoot, patientId, clusterId);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `IM${n}`), makeSyntheticDicom({ instance: n }));
      }
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", status, "votesCount",
           "abnormalVotes", "studyInstanceUid", "seriesInstanceUid", modality,
           "fileSha256", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'abnormal', 1, 1, $4, $5, 'CT', $6,
           '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`,
        {
          bind: [
            imageId(n),
            `/uploads/${patientId}/${clusterId}/IM${n}`,
            clusterId,
            study,
            series,
            verified ? 'a'.repeat(64) : null,
          ],
        }
      );
    };
    const addCluster = (id: string, patientId: string) =>
      sequelize.query(
        `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
         VALUES ($1, 'SYNTHETIC', 0, $2, now(), now())`,
        { bind: [id, patientId] }
      );
    const run = (options: Partial<StudySeriesModule.StudySeriesBackfillOptions> = {}) =>
      backfill.runStudySeriesBackfill(sequelize, {
        apply: false,
        includeTrashed: false,
        uploadRoot,
        hmacKey: HMAC_KEY,
        ...options,
      });
    const resultOf = (report: StudySeriesModule.StudySeriesReport, n: number) =>
      report.rows.find(({ imageId: id }) => id === imageId(n))?.result;

    beforeEach(async () => {
      await addPatient(P1);
      await addCluster(C1, P1);
    });

    it('dry-run plans the linking and writes nothing', async () => {
      await addImage({ n: 1 });
      await addImage({ n: 2 });

      const report = await run();

      expect(report.summary).toMatchObject({ wouldLink: 2, studiesToCreate: 1 });
      expect(report.studies).toEqual([
        expect.objectContaining({ action: 'create', images: 2, series: 1, warnings: [] }),
      ]);
      expect(await count('studies')).toBe(0);
      expect(await count('patients_images', '"seriesId" IS NOT NULL')).toBe(0);
    });

    it('apply links eligible images, with the date read from one file, keeping review data', async () => {
      await addImage({ n: 1 });
      await addImage({ n: 2 });
      await addImage({ n: 3, series: SERIES_B });

      const report = await run({ apply: true });

      expect(report.summary).toMatchObject({ linked: 3, studiesToCreate: 1 });
      const [study] = await sequelize.query<Record<string, unknown>>(
        `SELECT "patientId", "studyDate"::text AS "studyDate", "studyTime" FROM studies`,
        { type: QueryTypes.SELECT }
      );
      expect(study).toEqual({ patientId: P1, studyDate: '2020-01-01', studyTime: '120000' });
      expect(await count('series')).toBe(2);
      expect(
        await count(
          'patients_images',
          `"seriesId" IS NOT NULL AND status = 'abnormal' AND "votesCount" = 1
           AND "updatedAt" = '2020-01-01T00:00:00Z'`
        )
      ).toBe(3);
    });

    it('links even when the representative file is unavailable (date left empty)', async () => {
      await addImage({ n: 1, file: false });

      const report = await run({ apply: true });

      expect(resultOf(report, 1)).toBe('linked');
      expect(report.studies[0].warnings).toEqual(['representative_file_unavailable']);
      expect(await count('studies', '"studyDate" IS NULL AND "studyTime" IS NULL')).toBe(1);
    });

    it('skips and reports rows without UIDs or verified metadata', async () => {
      await addImage({ n: 1, study: null });
      await addImage({ n: 2, series: null });
      await addImage({ n: 3, verified: false });

      const report = await run({ apply: true });

      expect(resultOf(report, 1)).toBe('missing_study_uid');
      expect(resultOf(report, 2)).toBe('missing_series_uid');
      expect(resultOf(report, 3)).toBe('metadata_not_verified');
      expect(await count('studies')).toBe(0);
    });

    it('does not fix a study UID found under two patients', async () => {
      await addPatient(P2);
      await addCluster(C2, P2);
      await addImage({ n: 1 });
      await addImage({ n: 2, patientId: P2, clusterId: C2 });
      await addImage({ n: 3, study: STUDY_B, series: SERIES_B });

      const report = await run({ apply: true });

      expect(resultOf(report, 1)).toBe('study_ownership_conflict');
      expect(resultOf(report, 2)).toBe('study_ownership_conflict');
      expect(resultOf(report, 3)).toBe('linked');
      expect(report.conflicts.studyOwnership).toEqual([
        {
          key: expect.stringMatching(/^k-[0-9a-f]{16}$/),
          patientIds: [P1, P2],
          imageIds: [imageId(1), imageId(2)],
        },
      ]);
      expect(await count('studies', `"studyInstanceUid" = '${SYNTHETIC_STUDY_UID}'`)).toBe(0);
      expect(JSON.stringify(report)).not.toContain('2.25.');
    });

    it('does not fix a series UID found under two studies, nor one owned by an existing study', async () => {
      // An imported study already owns the default series.
      await importSlices(P1, [{ instance: 9 }]);
      await addImage({ n: 1, study: STUDY_B });

      const report = await run({ apply: true });

      expect(resultOf(report, 1)).toBe('series_ownership_conflict');
      expect(report.conflicts.seriesOwnership).toHaveLength(1);
      expect(await count('patients_images', `id = '${imageId(1)}' AND "seriesId" IS NULL`)).toBe(1);
    });

    it('reuses a study created by an import for the same patient', async () => {
      await importSlices(P1, [{ instance: 9 }]);
      await addImage({ n: 1 });

      const report = await run({ apply: true });

      expect(report.studies[0].action).toBe('reuse');
      expect(await count('studies')).toBe(1);
      expect(await count('patients_images', '"seriesId" IS NULL')).toBe(0);
    });

    it('is idempotent', async () => {
      await addImage({ n: 1 });
      await addImage({ n: 2, series: SERIES_B });
      await run({ apply: true });
      const snapshot = await sequelize.query(
        `SELECT id, "seriesId" FROM patients_images ORDER BY id`,
        { type: QueryTypes.SELECT }
      );

      const again = await run({ apply: true });

      expect(again.summary).toMatchObject({ unlinked: 0, linked: 0, alreadyLinked: 2 });
      expect(await count('studies')).toBe(1);
      expect(await count('series')).toBe(2);
      expect(
        await sequelize.query(`SELECT id, "seriesId" FROM patients_images ORDER BY id`, {
          type: QueryTypes.SELECT,
        })
      ).toEqual(snapshot);
    });

    it('skips images of trashed patients unless asked', async () => {
      await addPatient(P2, true);
      await addCluster(C2, P2);
      await addImage({ n: 1, patientId: P2, clusterId: C2 });

      expect(resultOf(await run({ apply: true }), 1)).toBe('skipped_trashed_patient');
      expect(resultOf(await run({ apply: true, includeTrashed: true }), 1)).toBe('linked');
    });

    it('refuses to run before the Study/Series migration is applied', async () => {
      const toRevert = migrations.length - upToStudySeries().length + 1;
      for (let i = 0; i < toRevert; i++) await migrator.migrateDown(sequelize);

      await expect(run({ apply: true })).rejects.toThrow(
        /Pending database migrations: 202609291200-study-series/
      );
    });
  });
});
