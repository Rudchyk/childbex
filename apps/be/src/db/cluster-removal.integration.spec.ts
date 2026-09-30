/**
 * Removal of the legacy clusters against PostgreSQL: the preflight of the
 * irreversible migration 202610010000-drop-patient-image-clusters (images
 * without a Series or verified metadata stop it, changing nothing), the
 * migration itself (schema, historical completion provenance, review data
 * and stored paths unchanged), the refused `down`, `audit cluster-removal`,
 * the obsolete maintenance commands before / after the drop, and imports
 * afterwards (no cluster, UUID-only storage paths). Synthetic data only.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_cluster_removal" (created when missing);
 * every test recreates its `public` schema and upload storage.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize } from 'sequelize';
import {
  buildTar,
  makeSyntheticDicom,
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
} from '../services/archive/__fixtures__/synthetic';
import type * as MigratorModule from './migrator';
import type * as AuditModule from './audit/cluster-removal.audit';
import type * as PatientsServiceModule from '../services/patients.service';

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() };
jest.mock('../services/logger.service', () => ({ logger: mockLogger }));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL cluster removal tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const DROP = '202610010000-drop-patient-image-clusters';
const PRE_DROP = '202609302100-review-completion-series-scope';
const HMAC_KEY = 'synthetic-test-key-synthetic-test-key';
const P1 = '11111111-1111-4111-8111-000000000001';
const C1 = '22222222-2222-4222-8222-000000000001';
const C2 = '22222222-2222-4222-8222-000000000002';
const ST1 = '44444444-4444-4444-8444-000000000001';
const SE1 = '55555555-5555-4555-8555-000000000001';
const img = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const LEGACY_COMPLETION = '66666666-6666-4666-8666-000000000001';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describeWithDatabase('legacy cluster removal (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let audit: typeof AuditModule;
  let importPatientArchiveFile: typeof PatientsServiceModule.importPatientArchiveFile;
  let tmp: string;
  let uploadRoot: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_cluster_removal`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-cluster-removal-'));
    uploadRoot = path.join(tmp, 'uploads');
    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.ARCHIVES_ROOT = path.join(tmp, 'archives');
    process.env.ARCHIVE_WORK_DIR = path.join(tmp, 'work');
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    ({ importPatientArchiveFile } = require('../services/patients.service'));
    ({ sequelize } = require('./sequelize'));
    migrator = require('./migrator');
    audit = require('./audit/cluster-removal.audit');
  });

  /** The schema just before the removal, with legacy (cluster-based) data. */
  beforeEach(async () => {
    jest.clearAllMocks();
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    await migrator.migrateUp(sequelize, undefined, { to: PRE_DROP });
    await sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
       VALUES ($1, 'Synthetic', 'synthetic', 'u', 'U', now(), now())`,
      { bind: [P1] }
    );
    for (const [cluster, n] of [[C1, 0], [C2, -1]] as const) {
      await sequelize.query(
        `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
         VALUES ($1, 'SYNTHETIC', $2, $3, now(), now())`,
        { bind: [cluster, n, P1] }
      );
    }
    await sequelize.query(
      `INSERT INTO studies (id, "patientId", "studyInstanceUid", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      { bind: [ST1, P1, SYNTHETIC_STUDY_UID] }
    );
    await sequelize.query(
      `INSERT INTO series (id, "studyId", "seriesInstanceUid", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now(), now())`,
      { bind: [SE1, ST1, SYNTHETIC_SERIES_UID] }
    );
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Helpers -----------------------------------------------------------------

  const rows = (sql: string, bind: unknown[] = []) =>
    sequelize.query<Record<string, unknown>>(sql, { bind, type: QueryTypes.SELECT });

  /** A legacy image (cluster-based path, `details` from the old heuristic). */
  const addLegacyImage = async (
    n: number,
    { linked = true, verified = true, broken = false, cluster = C1 } = {}
  ) => {
    const dir = path.join(uploadRoot, P1, cluster);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `IM${n}`), makeSyntheticDicom({ instance: n }));
    await sequelize.query(
      `INSERT INTO patients_images (id, source, "clusterId", "seriesId", "isBrocken", status,
         details, "sopInstanceUid", "fileSha256", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`,
      {
        bind: [
          img(n),
          `/uploads/${P1}/${cluster}/IM${n}`,
          cluster,
          linked ? SE1 : null,
          broken,
          broken ? 'broken' : 'not_reviewed',
          JSON.stringify({ normal: [0, 0, 1], outliers: [{ file: '/tmp/extract/IM', reason: 'geometry_outlier' }] }),
          `2.25.1000000000000000000000000${n}`,
          verified ? createHash('sha256').update(makeSyntheticDicom({ instance: n })).digest('hex') : null,
        ],
      }
    );
  };
  const executed = async () => (await migrator.getMigrationStatus(sequelize)).executed;
  const tableExists = async (table: string) =>
    (await rows('SELECT to_regclass($1) IS NOT NULL AS e', [table]))[0].e;

  // --- Preflight ---------------------------------------------------------------

  it('refuses with images not linked to a Series or with unverified metadata, changing nothing', async () => {
    await addLegacyImage(1);
    await addLegacyImage(2, { linked: false });
    await addLegacyImage(3, { linked: false, broken: true });
    await addLegacyImage(4, { verified: false });
    const before = await rows('SELECT * FROM patients_images ORDER BY id');

    const error = await migrator.migrateUp(sequelize).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('2 image(s) not linked to a DICOM Series (1 broken)');
    expect(message).toContain(`${img(2)}, ${img(3)}`);
    expect(message).toContain(`1 image(s) without verified metadata (0 broken): ${img(4)}`);
    // Ids only: no paths, UIDs or hashes.
    expect(message).not.toMatch(/uploads|2\.25\.|[0-9a-f]{64}/);
    expect(await executed()).not.toContain(DROP);
    expect(await tableExists('patient_images_clusters')).toBe(true);
    expect(await rows('SELECT * FROM patients_images ORDER BY id')).toEqual(before);

    const report = await audit.runClusterRemovalAudit(sequelize);
    expect(report).toMatchObject({
      clustersRemoved: false,
      ready: false,
      blockers: {
        withoutSeries: { total: 2, broken: 1, ids: [img(2), img(3)] },
        unverifiedMetadata: { total: 1, broken: 0, ids: [img(4)] },
      },
      info: { images: 4, clusters: 2 },
    });
  });

  it('a broken image without a Series is not an exception: it stops the removal too', async () => {
    await addLegacyImage(1);
    await addLegacyImage(3, { linked: false, broken: true, cluster: C2 });
    await expect(migrator.migrateUp(sequelize)).rejects.toThrow(/1 image\(s\) not linked to a DICOM Series \(1 broken\)/);
    expect(await tableExists('patient_images_clusters')).toBe(true);
    // Nothing deletes it automatically.
    expect(await rows('SELECT id FROM patients_images ORDER BY id')).toHaveLength(2);
  });

  // --- The migration -------------------------------------------------------------

  describe('with every image linked and verified', () => {
    beforeEach(async () => {
      await addLegacyImage(1);
      await addLegacyImage(2);
      await addLegacyImage(3, { broken: true, cluster: C2 });
      // Review history made per cluster before Series Finish review existed.
      await sequelize.query(
        `INSERT INTO patient_image_review_completions (id, "patientImageId", "runId", "scopeClusterId", "completedById", "completedByName", "createdAt")
         VALUES ($1, $2, '77777777-7777-4777-8777-000000000001', $3, 'sub-r', 'Reviewer', '2026-09-01T00:00:00Z')`,
        { bind: [LEGACY_COMPLETION, img(1), C1] }
      );
      await sequelize.query(
        `INSERT INTO patient_image_review_votes (id, "patientImageId", "reviewerId", "reviewerName", vote, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'sub-a', 'A', 'abnormal', now(), now())`,
        { bind: [img(2)] }
      );
    });

    it('removes the clusters, keeps provenance, review data and stored paths', async () => {
      expect((await audit.runClusterRemovalAudit(sequelize)).ready).toBe(true);
      const imagesBefore = await rows(
        `SELECT id, source, "seriesId", "reviewState", status::text AS status, "votesCount", "updatedAt"
         FROM patients_images ORDER BY id`
      );
      const votesBefore = await rows('SELECT * FROM patient_image_review_votes');
      const [completionBefore] = await rows('SELECT * FROM patient_image_review_completions');

      expect((await migrator.migrateUp(sequelize)).map(({ name }) => name)).toEqual([DROP]);

      const schema = await migrator.readActualSchema(sequelize);
      expect(schema.columns.patient_images_clusters).toBeUndefined();
      expect(schema.columns.patients_images).not.toHaveProperty('clusterId');
      expect(schema.columns.patients_images).not.toHaveProperty('details');
      expect(schema.columns.patients_images.seriesId).toEqual({ type: 'uuid', nullable: false });
      expect(schema.foreignKeys).toContainEqual(
        expect.objectContaining({ table: 'patients_images', columns: ['seriesId'], references: 'series', onDelete: 'CASCADE' })
      );
      expect(schema.foreignKeys.filter(({ references }) => references === 'patient_images_clusters')).toEqual([]);

      // Unchanged: images (paths still name the old cluster folder), votes.
      expect(
        await rows(
          `SELECT id, source, "seriesId", "reviewState", status::text AS status, "votesCount", "updatedAt"
           FROM patients_images ORDER BY id`
        )
      ).toEqual(imagesBefore);
      expect(await rows('SELECT * FROM patient_image_review_votes')).toEqual(votesBefore);
      // Historical provenance kept, only renamed.
      const { scopeClusterId, ...rest } = completionBefore;
      expect(await rows('SELECT * FROM patient_image_review_completions')).toEqual([
        { ...rest, legacyScopeClusterId: scopeClusterId },
      ]);
      expect(scopeClusterId).toBe(C1);
      // Exactly one scope, still.
      await expect(
        sequelize.query(
          `INSERT INTO patient_image_review_completions (id, "patientImageId", "runId", "legacyScopeClusterId", "scopeSeriesId", "completedById", "completedByName", "createdAt")
           VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, $3, 'u', 'U', now())`,
          { bind: [img(2), C1, SE1] }
        )
      ).rejects.toMatchObject({ parent: { code: '23514', constraint: 'patient_image_review_completions_one_scope' } });

      expect(await audit.runClusterRemovalAudit(sequelize)).toMatchObject({
        clustersRemoved: true,
        ready: true,
        info: { images: 3, clusters: null, clusterScopedCompletions: 1 },
      });
      await expect(migrator.assertSchemaUpToDate(sequelize)).resolves.toBeTruthy();
    });

    it('cannot be reverted (no fake reconstruction of clusters)', async () => {
      await migrator.migrateUp(sequelize);
      await expect(migrator.migrateDown(sequelize)).rejects.toThrow(/cannot be reverted/);
      expect(await executed()).toContain(DROP);
      expect(await tableExists('patient_images_clusters')).toBe(false);
    });

    it('the obsolete maintenance commands work before the drop and refuse after it', async () => {
      const tools = {
        'backfill dicom-metadata': () =>
          require('./backfill/dicom-metadata.backfill').runDicomMetadataBackfill(sequelize, {
            apply: false, batchSize: 100, includeTrashed: false, rescan: false, uploadRoot, hmacKey: HMAC_KEY,
          }),
        'backfill study-series': () =>
          require('./backfill/study-series.backfill').runStudySeriesBackfill(sequelize, {
            apply: false, includeTrashed: false, uploadRoot, hmacKey: HMAC_KEY,
          }),
        'cleanup duplicate-sop': () =>
          require('./cleanup/duplicate-sop.cleanup').runDuplicateSopCleanup(sequelize, {
            apply: false, group: null, uploadRoot, hmacKey: HMAC_KEY,
          }),
      };
      for (const [name, run] of Object.entries(tools)) {
        await expect([name, await run().then(() => 'ran')]).toEqual([name, 'ran']);
      }

      await migrator.migrateUp(sequelize);

      for (const [name, run] of Object.entries(tools)) {
        const error = await run().catch((e: Error) => e);
        expect([name, (error as Error).message]).toEqual([
          name,
          expect.stringContaining(`This command is obsolete since migration ${DROP}`),
        ]);
      }
      // Still supported after the drop.
      const reviewState = require('./backfill/review-state.backfill');
      await expect(reviewState.runReviewStateAudit(sequelize)).resolves.toMatchObject({
        summary: { images: 3, notDerived: 0 },
      });
    });
  });

  // --- Imports after the removal --------------------------------------------------

  it('imports without clusters: images under their Series, UUID-only storage paths', async () => {
    await migrator.migrateUp(sequelize);
    const entries = [
      { name: 'Doe_John/SE1/IM000001.dcm', data: makeSyntheticDicom({ instance: 1, rows: 16, cols: 16 }) },
      { name: 'Doe_John/SE1/IM000002.dcm', data: makeSyntheticDicom({ instance: 2, rows: 16, cols: 16 }) },
      // Formerly dropped as a geometry outlier.
      { name: 'Doe_John/SE1/IM000003.dcm', data: makeSyntheticDicom({ instance: 3, rows: 8, cols: 12 }) },
    ];
    const bytes = await buildTar(entries);
    const archivePath = path.join(tmp, 'archive.tar');
    await writeFile(archivePath, bytes);

    const result = await importPatientArchiveFile({
      uploadId: '00000000-0000-4000-8000-000000000001',
      patientId: P1,
      archivePath,
      extension: '.tar',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });

    expect(result).toMatchObject({ importedImages: 3, series: 1 });
    expect(await tableExists('patient_images_clusters')).toBe(false);
    const images = await rows(`SELECT id, source, "seriesId", rows, columns FROM patients_images ORDER BY "instanceNumber"`);
    expect(images.map(({ rows: r, columns: c }) => `${r}x${c}`)).toEqual(['16x16', '16x16', '8x12']);
    for (const image of images) {
      // The existing Series of the synthetic UID; path = patient/series/image id.
      expect(image.seriesId).toBe(SE1);
      expect(image.source).toBe(`/uploads/${P1}/${SE1}/${image.id}.dcm`);
      expect(image.source).toMatch(new RegExp(`^/uploads/${UUID}/${UUID}/${UUID}\\.dcm$`));
      expect(image.source).not.toMatch(/Doe|IM0000|2\.25\./);
    }
    expect((await readdir(path.join(uploadRoot, P1, SE1))).sort()).toEqual(
      images.map(({ id }) => `${id}.dcm`).sort()
    );
  });
});
