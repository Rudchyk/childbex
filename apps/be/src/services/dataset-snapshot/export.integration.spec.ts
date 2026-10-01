/**
 * Dataset snapshot export against PostgreSQL: only FINALIZED / ARCHIVED
 * snapshots, UUID-only file names, canonical manifest (no paths, file names,
 * UIDs), source and destination SHA-256 verification, atomic completion (a
 * failed export leaves nothing that looks complete), no database writes.
 * Synthetic data and files only.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_dataset_export" (created when missing).
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize } from 'sequelize';
import { PatientImageReviewVoteTypes as Vote } from '@libs/schemas';
import type * as MigratorModule from '../../db/migrator';
import type * as ReviewModule from '../review.service';
import type * as SnapshotModule from './snapshot.service';
import type * as ExportModule from './export';
import type * as CliModule from '../../db/snapshot/dataset-snapshot.cli';

jest.mock('../logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL dataset export tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const ADMIN = { id: 'sub-admin', name: 'Admin Operator' };
const uuid = (group: string, n: number) =>
  `${group.repeat(8)}-${group.repeat(4)}-4${group.repeat(3)}-8${group.repeat(3)}-${String(n).padStart(12, '0')}`;
const patientId = (n: number) => uuid('1', n);
const studyId = (n: number) => uuid('4', n);
const seriesId = (n: number) => uuid('5', n);
const imageId = (n: number) => uuid('3', n);
/** Stored in the DB / file system only: must never appear in an export. */
const SOURCE_NAME = 'Doe_John_CT';
const PATIENT_NAME = 'Doe^John';
const UID_PREFIX = '2.25.7777';

/** 6 patients (quotas 4 / 1 / 1); P1 has mixed labels. */
const images = [
  { n: 1, patient: 1, vote: Vote.NORMAL },
  { n: 2, patient: 1, vote: Vote.NORMAL },
  { n: 3, patient: 1, vote: Vote.ABNORMAL },
  { n: 4, patient: 2, vote: Vote.NORMAL },
  { n: 5, patient: 3, vote: Vote.ABNORMAL },
  { n: 6, patient: 3, vote: Vote.ABNORMAL },
  { n: 7, patient: 4, vote: Vote.NORMAL },
  { n: 8, patient: 5, vote: Vote.NORMAL },
  { n: 9, patient: 6, vote: Vote.ABNORMAL },
];

describeWithDatabase('dataset snapshot export (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let review: typeof ReviewModule;
  let snapshots: typeof SnapshotModule;
  let exporter: typeof ExportModule;
  let cli: typeof CliModule;
  let tmp: string;
  let uploadRoot: string;
  let archivesRoot: string;
  let out: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_dataset_export`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-export-'));
    uploadRoot = path.join(tmp, 'uploads');
    archivesRoot = path.join(tmp, 'archives');
    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.ARCHIVES_ROOT = archivesRoot;
    process.env.UPLOAD_SESSIONS_DIR = path.join(tmp, 'sessions');
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    require('../patients.service');
    ({ sequelize } = require('../../db/sequelize'));
    migrator = require('../../db/migrator');
    review = require('../review.service');
    snapshots = require('./snapshot.service');
    exporter = require('./export');
    cli = require('../../db/snapshot/dataset-snapshot.cli');
  });

  const fileBytes = (n: number) => Buffer.from(`synthetic dicom bytes #${String(n).padStart(4, '0')} ${'x'.repeat(n * 7)}`);
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const sourceFile = (n: number) => {
    const spec = images.find((image) => image.n === n) as (typeof images)[number];
    return path.join(uploadRoot, patientId(spec.patient), seriesId(spec.patient), `${SOURCE_NAME}_${n}.dcm`);
  };

  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    await mkdir(archivesRoot, { recursive: true });
    out = await mkdtemp(path.join(tmp, 'out-'));
    await migrator.migrateUp(sequelize);
    for (let p = 1; p <= 6; p++) {
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'u', 'U', now(), now())`,
        { bind: [patientId(p), PATIENT_NAME, `p${p}`] }
      );
      await sequelize.query(
        `INSERT INTO studies (id, "patientId", "studyInstanceUid", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
        { bind: [studyId(p), patientId(p), `${UID_PREFIX}0${p}`] }
      );
      await sequelize.query(
        `INSERT INTO series (id, "studyId", "seriesInstanceUid", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
        { bind: [seriesId(p), studyId(p), `${UID_PREFIX}00${p}`] }
      );
    }
    for (const spec of images) {
      const bytes = fileBytes(spec.n);
      await mkdir(path.dirname(sourceFile(spec.n)), { recursive: true });
      await writeFile(sourceFile(spec.n), bytes);
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "seriesId", "isBrocken", status,
           "instanceNumber", "imageOrientationPatient", "imagePositionPatient", "numberOfFrames",
           rows, columns, "pixelSpacing", "sopInstanceUid", "fileSha256", "fileSize",
           "createdAt", "updatedAt")
         VALUES ($1, $2, $3, false, 'not_reviewed', $4, '{1,0,0,0,1,0}', $5, 1, 4, 4, '{0.5,0.5}', $6, $7, $8, now(), now())`,
        {
          bind: [
            imageId(spec.n),
            `/uploads/${patientId(spec.patient)}/${seriesId(spec.patient)}/${SOURCE_NAME}_${spec.n}.dcm`,
            seriesId(spec.patient),
            spec.n,
            `{0,0,${spec.n}}`,
            `${UID_PREFIX}${spec.n}`,
            sha(bytes),
            bytes.length,
          ],
        }
      );
      await review.castVote(imageId(spec.n), { id: 'sub-r', name: 'Reviewer' }, { vote: spec.vote });
    }
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const rows = (sql: string, bind: unknown[] = []) =>
    sequelize.query<Record<string, unknown>>(sql, { bind, type: QueryTypes.SELECT });

  const finalized = async () => {
    const snapshot = await snapshots.createSnapshot(ADMIN, {
      name: 'Export test',
      description: 'synthetic',
      configuration: { split: { seed: 'export-seed-1' } },
    });
    await review.freezeReview(ADMIN, 'dataset');
    await snapshots.finalizeSnapshot(snapshot.id, ADMIN);
    return snapshot.id;
  };

  const roots = () => ({ uploadRoot, archivesRoot });
  const listTree = async (dir: string): Promise<string[]> =>
    (await readdir(dir, { recursive: true })).map((entry) => entry.split(path.sep).join('/')).sort();
  const textArtifacts = async (dir: string) =>
    (await Promise.all(['manifest.json', 'EXPORT_COMPLETE.json', 'README-SENSITIVE.txt'].map((name) => readFile(path.join(dir, name), 'utf8')))).join('\n');
  const assertNoLeak = (text: string) => {
    for (const forbidden of [SOURCE_NAME, PATIENT_NAME, UID_PREFIX, uploadRoot, tmp, '/uploads/', 'source', 'Admin Operator', 'Export test']) {
      expect(text).not.toContain(forbidden);
    }
  };

  it('exports a FINALIZED snapshot atomically: UUID-only files, canonical manifest, verified copies', async () => {
    const id = await finalized();
    const target = path.join(out, 'export');
    const summary = await exporter.exportSnapshot(id, target, roots());

    expect(await listTree(out)).toEqual(['export', ...(await listTree(target)).map((entry) => `export/${entry}`)].sort());
    const files = await readdir(path.join(target, 'dicom'));
    expect(files.sort()).toEqual(images.map((image) => `${imageId(image.n)}.dcm`).sort());
    for (const image of images) {
      expect(await readFile(path.join(target, 'dicom', `${imageId(image.n)}.dcm`))).toEqual(fileBytes(image.n));
    }

    const manifestText = await readFile(path.join(target, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(manifestText);
    const marker = JSON.parse(await readFile(path.join(target, 'EXPORT_COMPLETE.json'), 'utf8'));
    expect(sha(Buffer.from(manifestText, 'utf8'))).toBe(summary.manifestSha256);
    expect(marker).toMatchObject({
      exportFormatVersion: 1,
      manifestSchemaVersion: 1,
      snapshotId: id,
      manifestSha256: summary.manifestSha256,
      snapshotStatusAtExport: 'FINALIZED',
      itemCount: 9,
      sensitive: true,
      deidentified: false,
    });
    expect(Object.keys(manifest).sort()).toEqual(['items', 'manifestSchemaVersion', 'patients', 'snapshot']);
    expect(Object.keys(manifest.snapshot)).not.toContain('status');
    expect(manifest.snapshot).toMatchObject({ id, totalPatients: 6, totalImages: 9, normalImages: 5, abnormalImages: 4 });
    expect(Object.keys(manifest.items[0]).sort()).toEqual(
      ['fileSha256', 'fileSize', 'label', 'patientGroupKey', 'patientId', 'patientImageId', 'reviewStateAtSnapshot',
        'reviewStateSourceAtSnapshot', 'seriesId', 'seriesOrderIndex', 'split', 'studyId'].sort()
    );
    // Canonical order and no patient leakage.
    const sorted = [...manifest.items].sort(exporter.compareItems);
    expect(manifest.items).toEqual(sorted);
    const splitOf = new Map<string, string>(manifest.patients.map((p: { patientGroupKey: string; split: string }) => [p.patientGroupKey, p.split]));
    expect(splitOf.size).toBe(6);
    for (const item of manifest.items) expect(item.split).toBe(splitOf.get(item.patientGroupKey));
    expect(manifest.patients.map((p: { split: string }) => p.split)).toEqual(['TRAIN', 'TRAIN', 'TRAIN', 'TRAIN', 'VALIDATION', 'TEST']);

    assertNoLeak(await textArtifacts(target));
  });

  it('is deterministic; archiving changes only the marker status, not the manifest hash', async () => {
    const id = await finalized();
    const first = await exporter.exportSnapshot(id, path.join(out, 'a'), roots());
    await snapshots.archiveSnapshot(id, ADMIN);
    const second = await exporter.exportSnapshot(id, path.join(out, 'b'), roots());
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(await readFile(path.join(out, 'b', 'manifest.json'))).toEqual(await readFile(path.join(out, 'a', 'manifest.json')));
    expect(second.snapshotStatus).toBe('ARCHIVED');
  });

  it('holds no database transaction while files are copied', async () => {
    const id = await finalized();
    const otherOpenTransactions = async () =>
      Number(
        (
          await rows(
            `SELECT count(*)::int AS n FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND (state LIKE 'idle in transaction%' OR backend_xid IS NOT NULL OR backend_xmin IS NOT NULL)`
          )
        )[0].n
      );
    // Positive control: the probe sees a transaction that is held open.
    const held = await sequelize.transaction();
    await sequelize.query('SELECT 1', { transaction: held });
    expect(await otherOpenTransactions()).toBeGreaterThanOrEqual(1);
    await held.rollback();

    const openTransactions: number[] = [];
    await exporter.exportSnapshot(id, path.join(out, 'x'), {
      ...roots(),
      hooks: { afterCopy: async () => void openTransactions.push(await otherOpenTransactions()) },
    });
    expect(openTransactions).toHaveLength(9);
    expect(openTransactions.every((n) => n === 0)).toBe(true);
  });

  it('never writes to the database', async () => {
    const id = await finalized();
    const before = await rows(`SELECT * FROM dataset_snapshots`);
    const counts = async () =>
      rows(`SELECT (SELECT count(*) FROM dataset_snapshot_items)::int AS i, (SELECT count(*) FROM dataset_snapshot_patients)::int AS p`);
    const countsBefore = await counts();
    await exporter.exportSnapshot(id, path.join(out, 'x'), roots());
    expect(await rows(`SELECT * FROM dataset_snapshots`)).toEqual(before);
    expect(await counts()).toEqual(countsBefore);
  });

  it('refuses DRAFT and unknown snapshots without creating anything', async () => {
    const draft = await snapshots.createSnapshot(ADMIN, { name: 'd', configuration: {} });
    await expect(exporter.exportSnapshot(draft.id, path.join(out, 'd'), roots())).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_FINALIZED',
    });
    await expect(exporter.exportSnapshot(uuid('9', 9), path.join(out, 'u'), roots())).rejects.toMatchObject({
      code: 'SNAPSHOT_NOT_FOUND',
    });
    expect(await readdir(out)).toEqual([]);
  });

  it('refuses unsafe targets', async () => {
    const id = await finalized();
    await mkdir(path.join(out, 'exists'));
    await expect(exporter.exportSnapshot(id, path.join(out, 'exists'), roots())).rejects.toMatchObject({ code: 'OUTPUT_EXISTS' });
    await expect(exporter.exportSnapshot(id, path.join(uploadRoot, 'x'), roots())).rejects.toMatchObject({
      code: 'OUTPUT_INSIDE_STORAGE',
    });
    await expect(exporter.exportSnapshot(id, path.join(archivesRoot, 'x'), roots())).rejects.toMatchObject({
      code: 'OUTPUT_INSIDE_STORAGE',
    });
    await expect(exporter.exportSnapshot(id, path.join(out, 'missing', 'x'), roots())).rejects.toMatchObject({
      code: 'OUTPUT_PARENT_MISSING',
    });
    expect(await readdir(out)).toEqual(['exists']);
  });

  it('source problems: every failing file is reported and nothing is left behind', async () => {
    const id = await finalized();
    await rm(sourceFile(2));
    const tampered = fileBytes(5);
    tampered[0] ^= 0xff; // same size, other bytes
    await writeFile(sourceFile(5), tampered);
    await writeFile(sourceFile(7), Buffer.concat([fileBytes(7), Buffer.from('+')]));

    const error = await exporter.exportSnapshot(id, path.join(out, 'x'), roots()).catch((e) => e);
    expect(error).toMatchObject({ code: 'EXPORT_FILES_FAILED' });
    expect([...error.failures].sort((a, b) => a.patientImageId.localeCompare(b.patientImageId))).toEqual([
      { patientImageId: imageId(2), code: 'MISSING_FILE' },
      { patientImageId: imageId(5), code: 'FILE_HASH_MISMATCH' },
      { patientImageId: imageId(7), code: 'FILE_SIZE_MISMATCH' },
    ]);
    expect(await readdir(out)).toEqual([]);
  });

  it('a copy that does not match after writing fails the export (destination verification)', async () => {
    const id = await finalized();
    const error = await exporter
      .exportSnapshot(id, path.join(out, 'x'), {
        ...roots(),
        hooks: {
          afterCopy: async (tempFile, patientImageId) => {
            if (patientImageId === imageId(4)) {
              const bytes = await readFile(tempFile);
              bytes[bytes.length - 1] ^= 0xff;
              await writeFile(tempFile, bytes);
            }
          },
        },
      })
      .catch((e) => e);
    expect(error).toMatchObject({ code: 'EXPORT_FILES_FAILED', failures: [{ patientImageId: imageId(4), code: 'DESTINATION_HASH_MISMATCH' }] });
    expect(await readdir(out)).toEqual([]);
  });

  it('a failure after copying (before the completion marker) leaves no completed export', async () => {
    const id = await finalized();
    await expect(
      exporter.exportSnapshot(id, path.join(out, 'x'), {
        ...roots(),
        hooks: { beforeComplete: async () => Promise.reject(new Error('disk full (simulated)')) },
      })
    ).rejects.toThrow('disk full');
    expect(await readdir(out)).toEqual([]);
  });

  it('a completed export is relocatable: relative layout only', async () => {
    const id = await finalized();
    await exporter.exportSnapshot(id, path.join(out, 'x'), roots());
    const moved = path.join(tmp, `moved-${Date.now()}`);
    await cp(path.join(out, 'x'), moved, { recursive: true });
    await rm(path.join(out, 'x'), { recursive: true });
    const manifest = JSON.parse(await readFile(path.join(moved, 'manifest.json'), 'utf8'));
    for (const item of manifest.items) {
      const file = path.join(moved, 'dicom', `${item.patientImageId}.dcm`);
      expect((await stat(file)).size).toBe(item.fileSize);
      expect(sha(await readFile(file))).toBe(item.fileSha256);
    }
    await rm(moved, { recursive: true });
  });

  it('CLI: exports, prints ids and counts only, never paths', async () => {
    const id = await finalized();
    const target = path.join(out, 'cli-export');
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
    const spies = (['info', 'warn', 'error', 'log'] as const).map((method) => jest.spyOn(console, method).mockImplementation(capture));
    try {
      expect(await cli.runDatasetSnapshotCli(sequelize, ['export', id, '--output', target])).toBe(0);
      expect(await cli.runDatasetSnapshotCli(sequelize, ['export', id, '--output', target])).toBe(1); // exists
      await rm(sourceFile(3));
      expect(await cli.runDatasetSnapshotCli(sequelize, ['export', id, '--output', path.join(out, 'y')])).toBe(1);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const text = lines.join('\n');
    expect(text).toContain('not de-identified');
    expect(text).toContain(`${imageId(3)} MISSING_FILE`);
    expect(text).toContain('OUTPUT_EXISTS');
    assertNoLeak(text);
    expect(text).not.toContain(out);
  });
});
