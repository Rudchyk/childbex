/**
 * Unique SOP Instance UID (migration 202609301800-patient-image-sop-unique)
 * against a real PostgreSQL database: preflight, index, rollback, and the
 * import / backfill behavior with the index in place.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_unique" (created when missing).
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize } from 'sequelize';
import {
  buildTar,
  makeSyntheticDicom,
  type SyntheticDicomOptions,
} from '../services/archive/__fixtures__/synthetic';
import type * as MigratorModule from './migrator';
import type * as PatientsServiceModule from '../services/patients.service';
import type * as BackfillModule from './backfill/dicom-metadata.backfill';
import type * as CleanupModule from './cleanup/duplicate-sop.cleanup';

jest.mock('../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL unique SOP tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const UNIQUE_MIGRATION = '202609301800-patient-image-sop-unique';
/** Later migrations (review state) need their own backfill first. */
const upToUnique = { to: UNIQUE_MIGRATION };
const BEFORE_UNIQUE = '202609301200-patient-image-instance-indexes';
const HMAC_KEY = 'synthetic-test-key-synthetic-test-key';
const P1 = '11111111-1111-4111-8111-111111111111';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const DUPLICATE_SOP = '2.25.4242424242';
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describeWithDatabase('unique SOP Instance UID (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let importPatientArchiveFile: typeof PatientsServiceModule.importPatientArchiveFile;
  let tmp: string;
  let uploadRoot: string;
  let archiveCount = 0;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_unique`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-unique-'));
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
  });

  /** A database migrated up to (not including) the unique index. */
  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    await migrator.migrateUp(sequelize, undefined, { to: BEFORE_UNIQUE });
    await sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
       VALUES ($1, 'Synthetic', 'synthetic', 'u', 'U', now(), now())`,
      { bind: [P1] }
    );
    for (const [cluster, n] of [[C1, 0], [C2, 1]] as const) {
      await sequelize.query(
        `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
         VALUES ($1, 'SYNTHETIC', $2, $3, now(), now())`,
        { bind: [cluster, n, P1] }
      );
    }
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Helpers -----------------------------------------------------------------

  const indexes = async () =>
    (
      await sequelize.query<{ indexname: string; unique: boolean }>(
        `SELECT indexname, indexdef LIKE 'CREATE UNIQUE%' AS unique FROM pg_indexes
         WHERE schemaname = current_schema() AND tablename = 'patients_images'
           AND indexname LIKE 'patients_images_sop_instance_uid%'
         ORDER BY indexname`,
        { type: QueryTypes.SELECT }
      )
    ).map(({ indexname, unique }) => `${indexname}${unique ? ' (unique)' : ''}`);
  const executed = async () =>
    (await migrator.getMigrationStatus(sequelize)).executed;

  /** A legacy row with its stored file (bytes decide the hash). */
  const addRow = async (
    n: number,
    sop: string | null,
    bytes = Buffer.from(`synthetic bytes ${sop}`),
    cluster = C1
  ) => {
    const dir = path.join(uploadRoot, P1, cluster);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `IM${n}`), bytes);
    await sequelize.query(
      `INSERT INTO patients_images (id, source, "clusterId", "sopInstanceUid",
         "studyInstanceUid", "seriesInstanceUid", modality, "fileSha256", "fileSize",
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, '2.25.10', '2.25.20', 'CT', $5, $6, now(), now())`,
      {
        bind: [
          id(n),
          `/uploads/${P1}/${cluster}/IM${n}`,
          cluster,
          sop,
          sop ? sha(bytes) : null,
          bytes.length,
        ],
      }
    );
  };

  const importFiles = async (entries: [name: string, options: SyntheticDicomOptions][]) => {
    const number = ++archiveCount;
    const bytes = await buildTar(
      entries.map(([name, options]) => ({ name, data: makeSyntheticDicom(options) }))
    );
    const archivePath = path.join(tmp, `archive-${number}.tar`);
    await writeFile(archivePath, bytes);
    return importPatientArchiveFile({
      uploadId: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
      patientId: P1,
      archivePath,
      extension: '.tar',
      size: bytes.length,
      sha256: sha(bytes),
    });
  };

  // --- Migration ---------------------------------------------------------------

  it('replaces the non-unique index when there are no duplicates; NULLs stay allowed', async () => {
    await addRow(1, '2.25.1');
    await addRow(2, null);
    await addRow(3, null);
    expect(await indexes()).toEqual(['patients_images_sop_instance_uid']);

    await migrator.migrateUp(sequelize, undefined, upToUnique);

    expect(await executed()).toContain(UNIQUE_MIGRATION);
    expect(await indexes()).toEqual(['patients_images_sop_instance_uid_unique (unique)']);
    // More rows without a SOP UID are fine.
    await addRow(4, null);
    expect(
      (await sequelize.query(`SELECT 1 FROM patients_images WHERE "sopInstanceUid" IS NULL`, {
        type: QueryTypes.SELECT,
      })).length
    ).toBe(3);
  });

  it('refuses with duplicates, without changes and without naming the UID', async () => {
    await addRow(1, DUPLICATE_SOP);
    await addRow(2, DUPLICATE_SOP, undefined, C2);
    await addRow(3, '2.25.77');
    await addRow(4, '2.25.77', undefined, C2);

    const error = await migrator.migrateUp(sequelize, undefined, upToUnique).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const message = String((error as Error).message);
    expect(message).toContain('2 duplicate group(s)');
    expect(message).toContain('cleanup duplicate-sop');
    expect(message).not.toContain(DUPLICATE_SOP);
    expect(message).not.toContain('2.25.77');
    // Schema unchanged, migration not recorded, data untouched.
    expect(await indexes()).toEqual(['patients_images_sop_instance_uid']);
    expect(await executed()).not.toContain(UNIQUE_MIGRATION);
    expect(
      (await sequelize.query(`SELECT id FROM patients_images`, { type: QueryTypes.SELECT }))
        .length
    ).toBe(4);
  });

  it('succeeds after the duplicates were cleaned up', async () => {
    await addRow(1, DUPLICATE_SOP);
    await addRow(2, DUPLICATE_SOP, undefined, C2);
    await expect(migrator.migrateUp(sequelize, undefined, upToUnique)).rejects.toThrow(/duplicate group/);

    const cleanup: typeof CleanupModule = require('./cleanup/duplicate-sop.cleanup');
    const report = await cleanup.runDuplicateSopCleanup(sequelize, {
      apply: true,
      group: null,
      uploadRoot,
      hmacKey: HMAC_KEY,
    });
    expect(report.summary).toMatchObject({ safeIdentical: 1, rowsDeleted: 1 });
    expect((await cleanup.runDuplicateSopCleanup(sequelize, {
      apply: false, group: null, uploadRoot, hmacKey: HMAC_KEY,
    })).summary.duplicateGroups).toBe(0);

    await migrator.migrateUp(sequelize, undefined, upToUnique);

    expect(await executed()).toContain(UNIQUE_MIGRATION);
  });

  it('makes PostgreSQL reject a duplicate SOP UID (23505)', async () => {
    await addRow(1, DUPLICATE_SOP);
    await migrator.migrateUp(sequelize, undefined, upToUnique);

    await expect(addRow(2, DUPLICATE_SOP, undefined, C2)).rejects.toMatchObject({
      parent: { code: '23505', constraint: 'patients_images_sop_instance_uid_unique' },
    });
  });

  it('rolls back to the non-unique index without touching data; can be applied again', async () => {
    await addRow(1, DUPLICATE_SOP);
    await migrator.migrateUp(sequelize, undefined, upToUnique);

    const reverted = await migrator.migrateDown(sequelize);

    expect(reverted.map(({ name }) => name)).toEqual([UNIQUE_MIGRATION]);
    expect(await indexes()).toEqual(['patients_images_sop_instance_uid']);
    // A duplicate can technically be inserted again.
    await addRow(2, DUPLICATE_SOP, undefined, C2);
    await sequelize.query(`DELETE FROM patients_images WHERE id = $1`, { bind: [id(2)] });

    expect((await migrator.migrateUp(sequelize, undefined, upToUnique)).map(({ name }) => name)).toEqual([
      UNIQUE_MIGRATION,
    ]);
    expect(await indexes()).toEqual(['patients_images_sop_instance_uid_unique (unique)']);
  });

  it('lets maintenance commands run while the unique migration is still pending', async () => {
    const status = await migrator.getMigrationStatus(sequelize);
    expect(status.pending[0]).toBe(UNIQUE_MIGRATION);

    const cleanup: typeof CleanupModule = require('./cleanup/duplicate-sop.cleanup');
    await expect(
      cleanup.runDuplicateSopCleanup(sequelize, {
        apply: false,
        group: null,
        uploadRoot,
        hmacKey: HMAC_KEY,
      })
    ).resolves.toBeTruthy();
    // The backend itself does not start with a pending migration.
    await expect(migrator.assertSchemaUpToDate(sequelize)).rejects.toThrow(UNIQUE_MIGRATION);
  });

  // --- Import with the unique index --------------------------------------------

  describe('import with the unique index', () => {
    beforeEach(() => migrator.migrateUp(sequelize));

    it('still reports an identical instance as already imported (no DB error)', async () => {
      await importFiles([['A/IM1', { instance: 1 }]]);

      const second = await importFiles([['B/OTHER_NAME', { instance: 1 }]]);

      expect(second).toMatchObject({ importedImages: 0, alreadyImported: 1 });
    });

    it('still rejects other content under the same SOP UID with the explicit conflict', async () => {
      await importFiles([['IM1', { instance: 1 }]]);

      await expect(
        importFiles([['IM1', { instance: 1, rows: 8, cols: 8 }]])
      ).rejects.toMatchObject({ name: 'ArchiveError', code: 'SOP_INSTANCE_CONTENT_CONFLICT' });
    });
  });

  // --- Metadata backfill with the unique index --------------------------------

  describe('backfill dicom-metadata with the unique index', () => {
    const run = (apply: boolean) => {
      const backfill: typeof BackfillModule = require('./backfill/dicom-metadata.backfill');
      return backfill.runDicomMetadataBackfill(sequelize, {
        apply,
        batchSize: 200,
        includeTrashed: false,
        rescan: false,
        uploadRoot,
        hmacKey: HMAC_KEY,
      });
    };
    /** A legacy row without metadata, whose file is a real DICOM file. */
    const addLegacyRow = async (n: number, instance: number, cluster = C1) => {
      const dir = path.join(uploadRoot, P1, cluster);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `LEGACY${n}`), makeSyntheticDicom({ instance }));
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", details, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`,
        {
          bind: [
            id(n),
            `/uploads/${P1}/${cluster}/LEGACY${n}`,
            cluster,
            JSON.stringify({ normal: [0, 0, 1] }),
          ],
        }
      );
    };
    const readRow = async (n: number) =>
      (
        await sequelize.query(`SELECT * FROM patients_images WHERE id = $1`, {
          bind: [id(n)],
          type: QueryTypes.SELECT,
        })
      )[0];

    // The backfill works before the cluster removal (it refuses after it).
    beforeEach(() =>
      migrator.migrateUp(sequelize, undefined, {
        to: '202609302100-review-completion-series-scope',
      })
    );

    it('does not fill a SOP UID stored on another image: no partial update, other rows go on', async () => {
      // The instance is already stored (imported), and a legacy row holds
      // another copy of the same file; another legacy row is new. (Stored as
      // an import did before the clusters were removed.)
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", "sopInstanceUid", "fileSha256", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        {
          bind: [
            id(9),
            `/uploads/${P1}/${C1}/IMPORTED`,
            C1,
            '2.25.10000000000000000000000001',
            createHash('sha256').update(makeSyntheticDicom({ instance: 1 })).digest('hex'),
          ],
        }
      );
      await addLegacyRow(1, 1);
      await addLegacyRow(2, 2, C2);
      const before = await readRow(1);

      const dryRun = await run(false);
      expect(dryRun.rows.find((r) => r.imageId === id(1))?.result).toBe(
        'sop_instance_already_stored'
      );
      const report = await run(true);

      expect(report.rows.find((r) => r.imageId === id(1))).toEqual({
        imageId: id(1),
        patientId: P1,
        result: 'sop_instance_already_stored',
        filled: [],
        conflicts: [],
        flags: [],
      });
      expect(await readRow(1)).toEqual(before);
      expect(report.rows.find((r) => r.imageId === id(2))?.result).toBe('updated');
      expect(report.summary).toMatchObject({ sopInstanceAlreadyStored: 1, updated: 1 });
    });

    it('fills only the first of two legacy copies of one instance in a run', async () => {
      await addLegacyRow(1, 5);
      await addLegacyRow(2, 5, C2);

      const report = await run(true);

      expect(report.rows.map(({ result }) => result).sort()).toEqual([
        'sop_instance_already_stored',
        'updated',
      ]);
      expect(
        (await sequelize.query(
          `SELECT 1 FROM patients_images WHERE "sopInstanceUid" IS NOT NULL`,
          { type: QueryTypes.SELECT }
        )).length
      ).toBe(1);
    });
  });

  it('before the unique index, the backfill fills legacy duplicates (so cleanup sees them)', async () => {
    const backfill: typeof BackfillModule = require('./backfill/dicom-metadata.backfill');
    for (const [n, cluster] of [[1, C1], [2, C2]] as const) {
      const dir = path.join(uploadRoot, P1, cluster);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `LEGACY${n}`), makeSyntheticDicom({ instance: 7 }));
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, now(), now())`,
        { bind: [id(n), `/uploads/${P1}/${cluster}/LEGACY${n}`, cluster] }
      );
    }

    const report = await backfill.runDicomMetadataBackfill(sequelize, {
      apply: true,
      batchSize: 200,
      includeTrashed: false,
      rescan: false,
      uploadRoot,
      hmacKey: HMAC_KEY,
    });

    expect(report.summary).toMatchObject({ updated: 2, duplicateSopInstanceUidGroups: 1 });
    await expect(migrator.migrateUp(sequelize, undefined, upToUnique)).rejects.toThrow(/1 duplicate group/);
  });
});
