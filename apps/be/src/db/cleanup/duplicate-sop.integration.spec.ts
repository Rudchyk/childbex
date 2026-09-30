/**
 * Legacy duplicate SOP Instance UID cleanup against a real PostgreSQL
 * database and real files. Legacy duplicates are inserted directly (the
 * import no longer creates them).
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_cleanup" (created when missing); every test
 * recreates its `public` schema and upload storage.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueryTypes, Sequelize } from 'sequelize';
import type * as MigratorModule from '../migrator';
import type * as CleanupModule from './duplicate-sop.cleanup';
import type * as DedupModule from '../../services/instance-dedup.service';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL duplicate cleanup tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const HMAC_KEY = 'synthetic-test-key-synthetic-test-key';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const C1 = 'c1111111-1111-4111-8111-111111111111';
const C2 = 'c2222222-2222-4222-8222-222222222222';
const C3 = 'c3333333-3333-4333-8333-333333333333';
const STUDY = '2.25.10';
const SERIES = '2.25.20';
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const content = (label: string) => Buffer.from(`synthetic DICOM bytes ${label}`);

describeWithDatabase('duplicate SOP cleanup (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let cleanup: typeof CleanupModule;
  let dedup: typeof DedupModule;
  let tmp: string;
  let uploadRoot: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_cleanup`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-cleanup-'));
    uploadRoot = path.join(tmp, 'uploads');
    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;
    ({ sequelize } = require('../sequelize'));
    migrator = require('../migrator');
    cleanup = require('./duplicate-sop.cleanup');
    dedup = require('../../services/instance-dedup.service');
  });

  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    // A database before the unique SOP index (legacy duplicates possible).
    await migrator.migrateUp(sequelize, undefined, {
      to: '202609301200-patient-image-instance-indexes',
    });
    for (const patient of [P1, P2]) {
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now())`,
        { bind: [patient, `synthetic-${patient.slice(0, 4)}`] }
      );
    }
    for (const [cluster, patient, n] of [
      [C1, P1, 0],
      [C2, P1, 1],
      [C3, P2, 0],
    ] as const) {
      await sequelize.query(
        `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
         VALUES ($1, 'SYNTHETIC', $2, $3, now(), now())`,
        { bind: [cluster, n, patient] }
      );
    }
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Fixtures ----------------------------------------------------------------

  /** A legacy image row (as imported before PR4.1) and its stored file. */
  const addRow = async ({
    n,
    sop = '2.25.1',
    bytes = content('one'),
    cluster = C1,
    patient = P1,
    file = `IM${n}`,
    writeBytes = true,
    createdAt = `2025-01-01T00:00:${String(n).padStart(2, '0')}Z`,
    values = {},
  }: {
    n: number;
    sop?: string;
    bytes?: Buffer;
    cluster?: string;
    patient?: string;
    file?: string;
    writeBytes?: boolean;
    createdAt?: string;
    values?: Record<string, unknown>;
  }) => {
    const dir = path.join(uploadRoot, patient, cluster);
    await mkdir(dir, { recursive: true });
    if (writeBytes) await writeFile(path.join(dir, file), bytes);
    const row: Record<string, unknown> = {
      id: id(n),
      source: `/uploads/${patient}/${cluster}/${file}`,
      clusterId: cluster,
      sopInstanceUid: sop,
      studyInstanceUid: STUDY,
      seriesInstanceUid: SERIES,
      modality: 'CT',
      fileSha256: sha(bytes),
      fileSize: bytes.length,
      createdAt,
      updatedAt: createdAt,
      ...values,
    };
    const columns = Object.keys(row);
    await sequelize.query(
      `INSERT INTO patients_images (${columns.map((c) => `"${c}"`).join(', ')})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      { bind: Object.values(row) }
    );
  };
  const addVote = async (n: number, reviewer = 'r1') => {
    await sequelize.query(
      `INSERT INTO patient_image_review_votes (id, "patientImageId", "reviewerId", "reviewerName", vote, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'R', 'abnormal', now(), now())`,
      { bind: [randomUUID(), id(n), reviewer] }
    );
    await sequelize.query(
      `UPDATE patients_images SET "votesCount" = "votesCount" + 1,
         "abnormalVotes" = "abnormalVotes" + 1, status = 'abnormal' WHERE id = $1`,
      { bind: [id(n)] }
    );
  };

  const rowIds = async () =>
    (
      await sequelize.query<{ id: string }>(`SELECT id FROM patients_images ORDER BY id`, {
        type: QueryTypes.SELECT,
      })
    ).map(({ id: rowId }) => rowId);
  const readRow = async (n: number) =>
    (
      await sequelize.query(`SELECT * FROM patients_images WHERE id = $1`, {
        bind: [id(n)],
        type: QueryTypes.SELECT,
      })
    )[0];
  const storedFiles = async (): Promise<string[]> => {
    const out: string[] = [];
    const walk = async (dir: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push(path.relative(uploadRoot, full).split(path.sep).join('/'));
      }
    };
    await walk(uploadRoot);
    return out.sort();
  };
  const state = async () => ({
    rows: await sequelize.query(`SELECT * FROM patients_images ORDER BY id`, {
      type: QueryTypes.SELECT,
    }),
    votes: await sequelize.query(`SELECT * FROM patient_image_review_votes ORDER BY id`, {
      type: QueryTypes.SELECT,
    }),
    files: await storedFiles(),
  });

  const run = (options: Partial<CleanupModule.DuplicateSopCleanupOptions> = {}) =>
    cleanup.runDuplicateSopCleanup(sequelize, {
      apply: false,
      group: null,
      uploadRoot,
      hmacKey: HMAC_KEY,
      ...options,
    });
  const groupOf = (report: CleanupModule.DuplicateSopReport, n: number) =>
    report.groups.find(({ imageIds }) => imageIds.includes(id(n)));

  // --- Discovery and classification ---------------------------------------------

  it('finds groups of the same non-null SOP UID only', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    await addRow({ n: 3, sop: '2.25.2', bytes: content('single') });
    await addRow({ n: 4, sop: null as unknown as string, bytes: content('x') });
    await addRow({ n: 5, sop: null as unknown as string, bytes: content('y') });

    const report = await run();

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].imageIds).toEqual([id(1), id(2)]);
    expect(report.groups[0].key).toMatch(/^k-[0-9a-f]{16}$/);
  });

  it('classifies every kind of group', async () => {
    // SAFE_IDENTICAL, across clusters
    await addRow({ n: 1, sop: '2.25.1' });
    await addRow({ n: 2, sop: '2.25.1', cluster: C2 });
    // CONTENT_CONFLICT
    await addRow({ n: 3, sop: '2.25.3', bytes: content('three-a') });
    await addRow({ n: 4, sop: '2.25.3', bytes: content('three-b') });
    // OWNER_CONFLICT
    await addRow({ n: 5, sop: '2.25.5', bytes: content('five') });
    await addRow({ n: 6, sop: '2.25.5', bytes: content('five'), patient: P2, cluster: C3 });
    // STUDY_SERIES_CONFLICT
    await addRow({ n: 7, sop: '2.25.7', bytes: content('seven') });
    await addRow({ n: 8, sop: '2.25.7', bytes: content('seven'), values: { seriesInstanceUid: '2.25.21' } });
    // UNVERIFIED
    await addRow({ n: 9, sop: '2.25.9', bytes: content('nine') });
    await addRow({ n: 10, sop: '2.25.9', bytes: content('nine'), values: { fileSha256: null } });
    // METADATA_CONFLICT
    await addRow({ n: 11, sop: '2.25.11', bytes: content('eleven') });
    await addRow({ n: 12, sop: '2.25.11', bytes: content('eleven'), values: { modality: 'MR' } });
    // REVIEW_CONFLICT
    await addRow({ n: 13, sop: '2.25.13', bytes: content('thirteen') });
    await addRow({ n: 14, sop: '2.25.13', bytes: content('thirteen') });
    await addVote(13, 'r1');
    await addVote(14, 'r2');
    // FILE_PROBLEM: a missing file / a changed file
    await addRow({ n: 15, sop: '2.25.15', bytes: content('fifteen') });
    await addRow({ n: 16, sop: '2.25.15', bytes: content('fifteen'), writeBytes: false });
    await addRow({ n: 17, sop: '2.25.17', bytes: content('seventeen') });
    await addRow({ n: 18, sop: '2.25.17', bytes: content('seventeen') });
    await writeFile(path.join(uploadRoot, P1, C1, 'IM18'), 'changed on disk');

    const report = await run();

    const classOf = (n: number) => groupOf(report, n)?.classification;
    expect(classOf(1)).toBe('SAFE_IDENTICAL');
    expect(classOf(3)).toBe('CONTENT_CONFLICT');
    expect(classOf(5)).toBe('OWNER_CONFLICT');
    expect(classOf(7)).toBe('STUDY_SERIES_CONFLICT');
    expect(classOf(9)).toBe('UNVERIFIED');
    expect(classOf(11)).toBe('METADATA_CONFLICT');
    expect(groupOf(report, 11)?.reasons).toEqual(['modality']);
    expect(classOf(13)).toBe('REVIEW_CONFLICT');
    expect(groupOf(report, 15)).toMatchObject({ classification: 'FILE_PROBLEM', reasons: ['missing'] });
    expect(groupOf(report, 17)).toMatchObject({ classification: 'FILE_PROBLEM', reasons: ['hash_mismatch'] });
    expect(report.summary).toMatchObject({
      duplicateGroups: 9,
      safeIdentical: 1,
      contentConflict: 1,
      ownerConflict: 1,
      studySeriesConflict: 1,
      unverified: 1,
      metadataConflict: 1,
      reviewConflict: 1,
      fileProblem: 2,
      rowsToDelete: 1,
    });

    // --- apply: only the safe group changes -------------------------------------
    const before = await state();
    const applied = await run({ apply: true });

    expect(applied.summary).toMatchObject({ rowsDeleted: 1, canonicalRowsPreserved: 1 });
    const after = await state();
    expect(after.rows).toEqual(before.rows.filter((r) => (r as { id: string }).id !== id(2)));
    expect(after.votes).toEqual(before.votes);
    // Exactly the duplicate's file is gone; nothing else.
    expect(after.files).toEqual(before.files.filter((f) => f !== `${P1}/${C2}/IM2`));
    for (const n of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      expect(await rowIds()).toContain(id(n));
    }
  });

  // --- Review data -----------------------------------------------------------------

  it('keeps the reviewed row and removes only unreviewed duplicates', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2 });
    await addRow({ n: 3, cluster: C2 });
    await addVote(2);
    await sequelize.query(`UPDATE patients_images SET notes = 'suspicious' WHERE id = $1`, {
      bind: [id(2)],
    });
    const reviewed = await readRow(2);
    const votes = await sequelize.query(`SELECT * FROM patient_image_review_votes`, {
      type: QueryTypes.SELECT,
    });

    const report = await run({ apply: true });

    expect(report.groups[0]).toMatchObject({
      classification: 'SAFE_IDENTICAL',
      canonicalImageId: id(2),
      duplicateImageIds: [id(1), id(3)],
      action: 'cleaned',
    });
    expect(await rowIds()).toEqual([id(2)]);
    expect(await readRow(2)).toEqual(reviewed);
    expect(
      await sequelize.query(`SELECT * FROM patient_image_review_votes`, { type: QueryTypes.SELECT })
    ).toEqual(votes);
    expect(await storedFiles()).toEqual([`${P1}/${C1}/IM2`]);
    // The other cluster is left empty (reported, not deleted).
    expect(report.emptyClusters).toEqual([C2]);
    expect(
      await sequelize.query(`SELECT id FROM patient_images_clusters WHERE id = $1`, {
        bind: [C2],
        type: QueryTypes.SELECT,
      })
    ).toHaveLength(1);
  });

  it('leaves a group with two reviewed rows untouched', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    await addVote(1, 'r1');
    await sequelize.query(`UPDATE patients_images SET "adminResolutionId" = 'admin' WHERE id = $1`, {
      bind: [id(2)],
    });
    const before = await state();

    const report = await run({ apply: true });

    expect(report.groups[0]).toMatchObject({ classification: 'REVIEW_CONFLICT', action: 'none' });
    expect(await state()).toEqual(before);
  });

  it('picks the oldest row, then the smallest id, as canonical (deterministic)', async () => {
    await addRow({ n: 3, createdAt: '2025-01-01T00:00:00Z' });
    await addRow({ n: 2, createdAt: '2025-01-01T00:00:00Z' });
    await addRow({ n: 1, createdAt: '2025-06-01T00:00:00Z' });

    const first = await run();
    const second = await run();

    expect(first.groups[0].canonicalImageId).toBe(id(2));
    expect(second.groups[0]).toEqual(first.groups[0]);
  });

  // --- Files ------------------------------------------------------------------------

  it('removes only the hard-link name of a duplicate; the canonical file stays readable', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, writeBytes: false, file: 'IM2_LINK' });
    await link(path.join(uploadRoot, P1, C1, 'IM1'), path.join(uploadRoot, P1, C1, 'IM2_LINK'));

    const report = await run({ apply: true });

    expect(report.groups[0].fileActions).toEqual([
      { imageId: id(2), action: 'hardlink_name_removed' },
    ]);
    expect(await storedFiles()).toEqual([`${P1}/${C1}/IM1`]);
    expect(sha(await readFile(path.join(uploadRoot, P1, C1, 'IM1')))).toBe(sha(content('one')));
  });

  it('keeps a duplicate file reached through a directory link (only the row goes)', async () => {
    await addRow({ n: 1 });
    // C2's directory is a junction to C1's: the duplicate's path is not plain.
    await rm(path.join(uploadRoot, P1, C2), { recursive: true, force: true });
    await (await import('node:fs/promises')).symlink(
      path.join(uploadRoot, P1, C1),
      path.join(uploadRoot, P1, C2),
      'junction'
    );
    await writeFile(path.join(uploadRoot, P1, C1, 'IM2'), content('one'));
    await addRow({ n: 2, cluster: C2, writeBytes: false });

    const report = await run({ apply: true });

    expect(report.groups[0].fileActions).toEqual([{ imageId: id(2), action: 'file_kept' }]);
    expect(await rowIds()).toEqual([id(1)]);
    expect((await readdir(path.join(uploadRoot, P1, C1))).sort()).toEqual(['IM1', 'IM2']);
  });

  it('reports a failed file deletion; the database stays consistent', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });

    const report = await run({
      apply: true,
      removeFile: async () => {
        throw new Error('EPERM');
      },
    });

    expect(report.groups[0].fileActions).toEqual([
      { imageId: id(2), action: 'file_delete_failed' },
    ]);
    expect(report.summary.fileDeleteFailed).toBe(1);
    // Row gone (committed), canonical intact, the leftover file is reported.
    expect(await rowIds()).toEqual([id(1)]);
    expect(await storedFiles()).toEqual([`${P1}/${C1}/IM1`, `${P1}/${C2}/IM2`]);
    expect(sha(await readFile(path.join(uploadRoot, P1, C1, 'IM1')))).toBe(sha(content('one')));
  });

  // --- Revalidation and concurrency ---------------------------------------------------

  it('dry-run changes nothing', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    const before = await state();

    const report = await run();

    expect(report.groups[0].action).toBe('would_clean');
    expect(await state()).toEqual(before);
  });

  it('a vote added after the dry-run keeps that row (the apply re-reads everything)', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    const dryRun = await run();
    expect(dryRun.groups[0]).toMatchObject({ canonicalImageId: id(1), duplicateImageIds: [id(2)] });

    await addVote(2);
    const report = await run({ apply: true });

    // The voted row is kept as canonical; the planned deletion of it is not made.
    expect(report.groups[0]).toMatchObject({ canonicalImageId: id(2), action: 'cleaned' });
    expect(await rowIds()).toEqual([id(2)]);
    expect(
      await sequelize.query(`SELECT * FROM patient_image_review_votes`, { type: QueryTypes.SELECT })
    ).toHaveLength(1);
  });

  it('a vote added between the scan and the mutation aborts the group (changed_during_run)', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    const originalTransaction = sequelize.transaction.bind(sequelize);
    const spy = jest.spyOn(sequelize, 'transaction').mockImplementationOnce((async (
      ...args: unknown[]
    ) => {
      await addVote(2);
      return (originalTransaction as (...a: unknown[]) => unknown)(...args);
    }) as never);
    const before = { ids: await rowIds(), files: await storedFiles() };

    const report = await run({ apply: true });
    spy.mockRestore();

    expect(report.groups[0].action).toBe('changed_during_run');
    expect(await rowIds()).toEqual(before.ids);
    expect(await storedFiles()).toEqual(before.files);
  });

  it('--group selects one group but still revalidates it (no force)', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    await addRow({ n: 3, sop: '2.25.3', bytes: content('three') });
    await addRow({ n: 4, sop: '2.25.3', bytes: content('three'), cluster: C2 });
    const dryRun = await run();
    const key = groupOf(dryRun, 1)?.key as string;

    // The selected group becomes unsafe after the review of the dry-run.
    await writeFile(path.join(uploadRoot, P1, C2, 'IM2'), 'changed on disk');
    const before = await state();
    const report = await run({ apply: true, group: key });

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({
      key,
      classification: 'FILE_PROBLEM',
      reasons: ['hash_mismatch'],
      action: 'none',
    });
    // Nothing changed, also not in the other (safe, unselected) group.
    expect(await state()).toEqual(before);

    // Selecting the other group cleans only that one.
    const other = groupOf(dryRun, 3)?.key as string;
    const cleaned = await run({ apply: true, group: other });
    expect(cleaned.groups.map(({ key: k }) => k)).toEqual([other]);
    expect(await rowIds()).toEqual([id(1), id(2), id(3)]);
  });

  it('waits for a running import (same advisory lock) before mutating', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    const events: string[] = [];
    let release: () => void = () => undefined;
    const importHolding = sequelize.transaction(async (transaction) => {
      await dedup.acquireImportLock(sequelize, transaction);
      events.push('import: lock taken');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      events.push('import: committing');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cleaning = run({ apply: true }).then((report) => {
      events.push('cleanup: done');
      return report;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    events.push('import: releasing');
    release();
    await importHolding;
    const report = await cleaning;

    expect(events).toEqual([
      'import: lock taken',
      'import: releasing',
      'import: committing',
      'cleanup: done',
    ]);
    expect(report.groups[0].action).toBe('cleaned');
  });

  it('a failure inside a group rolls it back completely; other groups continue', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    await addRow({ n: 3, sop: '2.25.3', bytes: content('three') });
    await addRow({ n: 4, sop: '2.25.3', bytes: content('three'), cluster: C2 });
    const originalQuery = sequelize.query.bind(sequelize);
    let deletes = 0;
    const spy = jest.spyOn(sequelize, 'query').mockImplementation(((
      sql: string,
      ...args: unknown[]
    ) => {
      if (typeof sql === 'string' && sql.includes('DELETE FROM patients_images') && deletes++ === 0) {
        return Promise.reject(new Error('delete failed'));
      }
      return (originalQuery as (...a: unknown[]) => unknown)(sql, ...args);
    }) as never);

    const report = await run({ apply: true });
    spy.mockRestore();

    expect(groupOf(report, 1)?.action).toBe('failed');
    expect(groupOf(report, 3)?.action).toBe('cleaned');
    expect(await rowIds()).toEqual([id(1), id(2), id(3)]);
    expect(await storedFiles()).toEqual([`${P1}/${C1}/IM1`, `${P1}/${C1}/IM3`, `${P1}/${C2}/IM2`]);
  });

  it('is idempotent', async () => {
    await addRow({ n: 1 });
    await addRow({ n: 2, cluster: C2 });
    await run({ apply: true });
    const after = await state();

    const again = await run({ apply: true });

    expect(again.summary).toMatchObject({ duplicateGroups: 0, rowsDeleted: 0 });
    expect(await state()).toEqual(after);
  });

  it('writes no UIDs, hashes, file names or paths into the report', async () => {
    await addRow({ n: 1, file: 'Doe_John.dcm' });
    await addRow({ n: 2, cluster: C2, file: 'Doe_John_copy.dcm' });

    const serialized = JSON.stringify(await run({ apply: true }));

    for (const secret of ['2.25.', sha(content('one')), 'Doe_John', uploadRoot, JSON.stringify(uploadRoot).slice(1, -1)]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
