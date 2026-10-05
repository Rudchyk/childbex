/**
 * ML dataset snapshots against PostgreSQL (and over HTTP with a fake
 * Keycloak): DRAFT previews write nothing; finalization re-hashes every
 * included file with review open, then captures the labels under a short
 * exclusive review lock (label mutations refused at once with REVIEW_LOCKED,
 * viewing and non-label writes unaffected, released on success and on
 * failure), splits by patient without leakage and stores immutable
 * provenance; finalized data survives later review changes, imports and
 * trash; permanent patient deletion is blocked.
 * Synthetic data and files only.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_datasets" (created when missing); every
 * test recreates its `public` schema and upload storage.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import { PatientImageReviewVoteTypes as Vote, ReviewResolutionLabel } from '@libs/schemas';
import type * as MigratorModule from '../../db/migrator';
import type * as ReviewModule from '../review.service';
import type * as SnapshotModule from './snapshot.service';
import type * as ApiModule from '../../api/v1/api';

jest.mock('../logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL dataset snapshot tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const ADMIN = { id: 'sub-admin', name: 'Admin' };
const uuid = (group: string, n: number) =>
  `${group.repeat(8)}-${group.repeat(4)}-4${group.repeat(3)}-8${group.repeat(3)}-${String(n).padStart(12, '0')}`;
const patientId = (n: number) => uuid('1', n);
const studyId = (n: number) => uuid('4', n);
const seriesId = (n: number) => uuid('5', n);
const imageId = (n: number) => uuid('3', n);
/** Stored in the DB only: must never be returned. */
const SOURCE_NAME = 'Doe_John_CT';
const UID_PREFIX = '2.25.7777';

type State = 'NORMAL_VOTE' | 'ABNORMAL_VOTE' | 'FINISH' | 'RESOLVED_ABNORMAL' | 'NOT_REVIEWED' | 'UNCERTAIN' | 'CONFLICTED';

interface ImageSpec {
  n: number;
  patient: number;
  series?: number;
  state: State;
  broken?: boolean;
  rows?: number;
  /** File trouble: removed, other size, same size other bytes. */
  file?: 'missing' | 'size' | 'bytes';
}

/**
 * 8 eligible patients (P1-P8; P4 mixed labels, P5 with every exclusion
 * state), P9 trashed, P10 with an unsupported series and file problems.
 */
const images: ImageSpec[] = [
  { n: 1, patient: 1, state: 'NORMAL_VOTE' },
  { n: 2, patient: 1, state: 'NORMAL_VOTE' },
  { n: 3, patient: 1, state: 'NORMAL_VOTE' },
  { n: 4, patient: 2, state: 'FINISH' },
  { n: 5, patient: 2, state: 'FINISH' },
  { n: 6, patient: 3, state: 'ABNORMAL_VOTE' },
  { n: 7, patient: 3, state: 'ABNORMAL_VOTE' },
  { n: 8, patient: 4, state: 'NORMAL_VOTE' },
  { n: 9, patient: 4, state: 'RESOLVED_ABNORMAL' },
  { n: 10, patient: 5, state: 'NORMAL_VOTE' },
  { n: 11, patient: 5, state: 'NOT_REVIEWED' },
  { n: 12, patient: 5, state: 'UNCERTAIN' },
  { n: 13, patient: 5, state: 'CONFLICTED' },
  { n: 14, patient: 5, state: 'NOT_REVIEWED', broken: true },
  { n: 15, patient: 6, state: 'NORMAL_VOTE' },
  { n: 16, patient: 6, state: 'NORMAL_VOTE' },
  { n: 17, patient: 7, state: 'ABNORMAL_VOTE' },
  { n: 18, patient: 7, state: 'ABNORMAL_VOTE' },
  { n: 19, patient: 8, state: 'NORMAL_VOTE' },
  { n: 20, patient: 8, state: 'NORMAL_VOTE' },
  { n: 21, patient: 9, state: 'NORMAL_VOTE' },
  // P10: series 10 has mixed geometry (not fully reviewable).
  { n: 22, patient: 10, series: 10, state: 'NORMAL_VOTE' },
  { n: 23, patient: 10, series: 10, state: 'NORMAL_VOTE', rows: 8 },
  // P10, series 11: every file has a problem.
  { n: 24, patient: 10, series: 11, state: 'NORMAL_VOTE', file: 'missing' },
  { n: 25, patient: 10, series: 11, state: 'NORMAL_VOTE', file: 'size' },
  { n: 26, patient: 10, series: 11, state: 'NORMAL_VOTE', file: 'bytes' },
];

describeWithDatabase('dataset snapshots (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let review: typeof ReviewModule;
  let snapshots: typeof SnapshotModule;
  let tmp: string;
  let uploadRoot: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_datasets`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-datasets-'));
    uploadRoot = path.join(tmp, 'uploads');
    process.env.UPLOAD_ROOT = uploadRoot;
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
  });

  // --- Fixture -------------------------------------------------------------------

  const fileBytes = (n: number) => Buffer.from(`synthetic dicom bytes #${String(n).padStart(4, '0')}`);
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

  const addImage = async (spec: ImageSpec) => {
    const series = seriesId(spec.series ?? spec.patient);
    const bytes = fileBytes(spec.n);
    const dir = path.join(uploadRoot, patientId(spec.patient), series);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${SOURCE_NAME}_${spec.n}.dcm`);
    if (spec.file !== 'missing') {
      await writeFile(
        file,
        spec.file === 'size'
          ? Buffer.concat([bytes, Buffer.from('+')])
          : spec.file === 'bytes'
            ? Buffer.from(bytes.toString().replace('#', '@')) // same size, other bytes
            : bytes
      );
    }
    await sequelize.query(
      `INSERT INTO patients_images (id, source, "seriesId", "isBrocken", status, notes,
         "instanceNumber", "imageOrientationPatient", "imagePositionPatient", "numberOfFrames",
         rows, columns, "pixelSpacing", "sopInstanceUid", "fileSha256", "fileSize",
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, '{1,0,0,0,1,0}', $8, 1, $9, 4, '{0.5,0.5}', $10, $11, $12, now(), now())`,
      {
        bind: [
          imageId(spec.n),
          `/uploads/${patientId(spec.patient)}/${series}/${SOURCE_NAME}_${spec.n}.dcm`,
          series,
          !!spec.broken,
          spec.broken ? 'broken' : 'not_reviewed',
          spec.broken ? 'pixeldata_truncated' : null,
          spec.n,
          `{0,0,${spec.n}}`,
          spec.rows ?? 4,
          `${UID_PREFIX}${spec.n}`,
          sha(bytes),
          bytes.length,
        ],
      }
    );
  };

  const reviewer = (name: string) => ({ id: `sub-${name}`, name: `Reviewer ${name}` });

  const applyState = async ({ n, state, patient, series }: ImageSpec) => {
    const image = imageId(n);
    switch (state) {
      case 'NORMAL_VOTE':
        return review.castVote(image, reviewer('a'), { vote: Vote.NORMAL });
      case 'ABNORMAL_VOTE':
        return review.castVote(image, reviewer('a'), { vote: Vote.ABNORMAL });
      case 'RESOLVED_ABNORMAL':
        await review.castVote(image, reviewer('a'), { vote: Vote.NORMAL });
        return review.setResolution(image, ADMIN, { label: ReviewResolutionLabel.ABNORMAL });
      case 'UNCERTAIN':
        return review.castVote(image, reviewer('a'), { vote: Vote.UNCERTAIN });
      case 'CONFLICTED':
        await review.castVote(image, reviewer('a'), { vote: Vote.NORMAL });
        return review.castVote(image, reviewer('b'), { vote: Vote.ABNORMAL });
      case 'FINISH': {
        const s = seriesId(series ?? patient);
        const ids = images.filter((i) => (i.series ?? i.patient) === (series ?? patient) && !i.broken).map((i) => imageId(i.n));
        return review.completeSeriesReview(patientId(patient), s, reviewer('f'), ids).catch(() => undefined);
      }
      default:
        return undefined;
    }
  };

  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await rm(uploadRoot, { recursive: true, force: true });
    await mkdir(uploadRoot, { recursive: true });
    await migrator.migrateUp(sequelize);
    for (let p = 1; p <= 10; p++) {
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt", "deletedAt")
         VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now(), $3)`,
        { bind: [patientId(p), `p${p}`, p === 9 ? new Date() : null] }
      );
      await sequelize.query(
        `INSERT INTO studies (id, "patientId", "studyInstanceUid", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
        { bind: [studyId(p), patientId(p), `${UID_PREFIX}0${p}`] }
      );
    }
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      await sequelize.query(
        `INSERT INTO series (id, "studyId", "seriesInstanceUid", "createdAt", "updatedAt") VALUES ($1, $2, $3, now(), now())`,
        { bind: [seriesId(s), studyId(s === 11 ? 10 : s), `${UID_PREFIX}00${s}`] }
      );
    }
    for (const spec of images) await addImage(spec);
    for (const spec of images) await applyState(spec);
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const rows = (sql: string, bind: unknown[] = []) =>
    sequelize.query<Record<string, unknown>>(sql, { bind, type: QueryTypes.SELECT });
  const count = async (table: string) => Number((await rows(`SELECT count(*)::int AS n FROM ${table}`))[0].n);
  const draft = (configuration = {}) =>
    snapshots.createSnapshot(ADMIN, { name: 'CT v1', description: 'synthetic', configuration });
  const SEED = { split: { seed: 'fixed-seed-1' } };
  const membership = async (snapshotId: string) => ({
    snapshot: await rows(`SELECT * FROM dataset_snapshots WHERE id = $1`, [snapshotId]),
    patients: await rows(`SELECT * FROM dataset_snapshot_patients WHERE "snapshotId" = $1 ORDER BY "patientGroupKey"`, [snapshotId]),
    items: await rows(`SELECT * FROM dataset_snapshot_items WHERE "snapshotId" = $1 ORDER BY "patientImageId"`, [snapshotId]),
    exclusions: await rows(`SELECT * FROM dataset_snapshot_exclusions WHERE "snapshotId" = $1 ORDER BY "patientImageId"`, [snapshotId]),
  });
  const finalizeFrozen = async (id: string) => {
    await review.freezeReview(ADMIN, 'dataset').catch(() => undefined);
    return snapshots.finalizeSnapshot(id, { id: 'sub-final', name: 'Finalizer' });
  };

  // --- DRAFT and preview ---------------------------------------------------------------

  it('a DRAFT stores its configuration only; preview writes nothing and reports every exclusion', async () => {
    const snapshot = await draft(SEED);
    const preview = await snapshots.previewSnapshot(snapshot.id);

    expect(snapshot).toMatchObject({ status: 'DRAFT', datasetSchemaVersion: 1, totalImages: null, splits: null });
    for (const table of ['dataset_snapshot_items', 'dataset_snapshot_patients', 'dataset_snapshot_exclusions']) {
      expect([table, await count(table)]).toEqual([table, 0]);
    }
    expect(preview).toMatchObject({
      reviewFrozen: false,
      fileVerification: 'EXISTS_AND_SIZE',
      // Image 26 (same size, other bytes) passes the cheap check: P10 counts
      // here; finalization re-hashes and excludes it.
      eligiblePatients: 9,
      eligibleImages: 17,
      labels: { NORMAL: 12, ABNORMAL: 5 },
      bySource: { VOTES: 14, FINISH_REVIEW: 2, RESOLUTION: 1 },
      excluded: {
        total: 9,
        byReason: {
          PATIENT_TRASHED: 1,
          BROKEN: 1,
          SERIES_NOT_FULLY_REVIEWABLE: 2,
          NOT_REVIEWED: 1,
          UNCERTAIN: 1,
          CONFLICTED: 1,
          MISSING_FILE: 1,
          FILE_SIZE_MISMATCH: 1,
        },
      },
      quotas: { TRAIN: 6, VALIDATION: 2, TEST: 1 },
      splitError: null,
    });
    expect(preview.eligibleImages + preview.excluded.total).toBe(images.length);
    // Deterministic.
    expect(await snapshots.previewSnapshot(snapshot.id)).toEqual(preview);
  });

  it('a DRAFT can be edited and previewed again; configured sources are applied', async () => {
    const snapshot = await draft(SEED);
    await snapshots.updateDraft(snapshot.id, { configuration: { includeReviewSources: ['VOTES', 'RESOLUTION'] as never } });
    const preview = await snapshots.previewSnapshot(snapshot.id);
    expect(preview.excluded.byReason).toMatchObject({ REVIEW_SOURCE_NOT_INCLUDED: 2 });
    expect(preview.bySource).not.toHaveProperty('FINISH_REVIEW');
    expect(preview.configuration.split.seed).toBe('fixed-seed-1');
  });

  // --- Finalization ------------------------------------------------------------------------

  it('needs no manual freeze: the short capture window is recorded and review is open again', async () => {
    const snapshot = await draft(SEED);
    const result = await snapshots.finalizeSnapshot(snapshot.id, { id: 'sub-final', name: 'Finalizer' });
    expect(result).toMatchObject({ status: 'FINALIZED', totalImages: 16 });
    expect(
      await rows(
        `SELECT id, reason, "frozenById", "unfrozenById", "frozenAt" <= "unfrozenAt" AS ordered
         FROM review_freezes`
      )
    ).toEqual([
      {
        id: result.reviewFreezeId,
        reason: `Dataset snapshot capture ${snapshot.id}`,
        frozenById: 'sub-final',
        unfrozenById: 'sub-final',
        ordered: true,
      },
    ]);
    // Neither frozen nor locked afterwards.
    expect(await review.getReviewFreezeState()).toMatchObject({ frozen: false });
    await review.castVote(imageId(1), reviewer('z'), { vote: Vote.ABNORMAL });
  });

  it('re-hashes every included file: same-size modified bytes are excluded (FILE_HASH_MISMATCH)', async () => {
    const snapshot = await draft(SEED);
    const freeze = await review.freezeReview(ADMIN, 'dataset');
    const result = await snapshots.finalizeSnapshot(snapshot.id, { id: 'sub-final', name: 'Finalizer' });
    void freeze;

    expect(result).toMatchObject({
      status: 'FINALIZED',
      fileVerification: 'SHA256_REHASHED',
      finalizedByName: 'Finalizer',
      totalPatients: 8,
      totalImages: 16,
      normalImages: 11,
      abnormalImages: 5,
      excludedImages: 10,
      exclusionSummary: expect.objectContaining({ FILE_HASH_MISMATCH: 1, MISSING_FILE: 1, FILE_SIZE_MISMATCH: 1 }),
    });
    const [{ id: freezeId }] = await rows(`SELECT id FROM review_freezes WHERE "unfrozenAt" IS NULL`);
    expect(result.reviewFreezeId).toBe(freezeId);
    expect(await rows(`SELECT reason FROM dataset_snapshot_exclusions WHERE "patientImageId" = $1`, [imageId(26)])).toEqual([
      { reason: 'FILE_HASH_MISMATCH' },
    ]);
    // Every excluded image has exactly one reason; every image is accounted for.
    expect((await count('dataset_snapshot_items')) + (await count('dataset_snapshot_exclusions'))).toBe(images.length);
  });

  it('finalization computes quotas and minPatientsPerSplit on the set left AFTER strong verification', async () => {
    // 0.6 / 0.2 / 0.2, at least 2 patients per split. The preview (cheap
    // checks) still counts P10 through image 26 (same size, other bytes):
    // 9 patients -> 5 / 2 / 2, valid. Re-hashing excludes it: 8 patients
    // -> 5 / 2 / 1, below the minimum -> refused, nothing stored.
    const strict = await draft({ split: { seed: 'fixed-seed-1', train: 0.6, validation: 0.2, test: 0.2, minPatientsPerSplit: 2 } });
    const preview = await snapshots.previewSnapshot(strict.id);
    expect(preview).toMatchObject({ eligiblePatients: 9, quotas: { TRAIN: 5, VALIDATION: 2, TEST: 2 }, splitError: null });

    await review.freezeReview(ADMIN, 'dataset');
    await expect(snapshots.finalizeSnapshot(strict.id, ADMIN)).rejects.toMatchObject({
      code: 'INSUFFICIENT_PATIENTS',
      status: 422,
      message: expect.stringContaining('8 eligible patient(s) give TRAIN 5, VALIDATION 2, TEST 1'),
    });
    expect((await snapshots.getSnapshot(strict.id)).status).toBe('DRAFT');
    expect(await count('dataset_snapshot_items')).toBe(0);

    // With the default ratios the finalized quotas are those of the verified
    // 8 patients (6 / 1 / 1), not the preview's 9 (6 / 2 / 1).
    const loose = await draft(SEED);
    expect((await snapshots.previewSnapshot(loose.id)).quotas).toEqual({ TRAIN: 6, VALIDATION: 2, TEST: 1 });
    const finalized = await snapshots.finalizeSnapshot(loose.id, ADMIN);
    expect(finalized.totalPatients).toBe(8);
    expect(
      Object.fromEntries(Object.entries(finalized.splits ?? {}).map(([split, counts]) => [split, counts.patients]))
    ).toEqual({ TRAIN: 6, VALIDATION: 1, TEST: 1 });
  });

  it('splits by patient with zero leakage; the split of every image is its patient\'s', async () => {
    const snapshot = await draft(SEED);
    await finalizeFrozen(snapshot.id);

    expect(
      await rows(`SELECT "patientId" FROM dataset_snapshot_items WHERE "snapshotId" = $1
                  GROUP BY "patientId" HAVING count(DISTINCT split) > 1`, [snapshot.id])
    ).toEqual([]);
    expect(
      await rows(`SELECT it.id FROM dataset_snapshot_items it
                  JOIN dataset_snapshot_patients p ON p."snapshotId" = it."snapshotId" AND p."patientGroupKey" = it."patientGroupKey"
                  WHERE it.split <> p.split`)
    ).toEqual([]);
    const bySplit = await rows(`SELECT split, count(*)::int AS patients FROM dataset_snapshot_patients GROUP BY split ORDER BY split`);
    expect(bySplit).toEqual([
      { split: 'TEST', patients: 1 },
      { split: 'TRAIN', patients: 6 },
      { split: 'VALIDATION', patients: 1 },
    ]);
    // The mixed-label patient P4 is one unit, keeping per-image labels.
    expect(
      await rows(`SELECT DISTINCT split, label FROM dataset_snapshot_items WHERE "patientId" = $1 ORDER BY label`, [patientId(4)])
    ).toHaveLength(2);
    expect(await rows(`SELECT stratum FROM dataset_snapshot_patients WHERE "patientId" = $1`, [patientId(4)])).toEqual([
      { stratum: 'MIXED' },
    ]);
    // The database refuses an item whose split differs from its patient's.
    await expect(
      sequelize.query(`UPDATE dataset_snapshot_items SET split = 'TEST' WHERE split <> 'TEST'`)
    ).rejects.toMatchObject({ parent: { code: '55000' } });
  });

  it('identical data and seed give an identical split', async () => {
    const a = await draft(SEED);
    const b = await draft(SEED);
    await finalizeFrozen(a.id);
    await finalizeFrozen(b.id);
    const splits = async (id: string) =>
      rows(`SELECT "patientGroupKey", split, "splitRank" FROM dataset_snapshot_patients WHERE "snapshotId" = $1 ORDER BY "patientGroupKey"`, [id]);
    expect(await splits(b.id)).toEqual(await splits(a.id));
  });

  it('freezes the review provenance, hashes, ids, creator, finalizer and configuration', async () => {
    const snapshot = await draft(SEED);
    await finalizeFrozen(snapshot.id);
    const item = async (n: number) =>
      (await rows(`SELECT * FROM dataset_snapshot_items WHERE "patientImageId" = $1`, [imageId(n)]))[0];
    const [resolution] = await rows(`SELECT id FROM patient_image_review_resolutions WHERE "patientImageId" = $1 AND "supersededAt" IS NULL`, [imageId(9)]);

    expect(await item(9)).toMatchObject({
      label: 'ABNORMAL',
      reviewStateAtSnapshot: 'ABNORMAL',
      reviewStateSourceAtSnapshot: 'RESOLUTION',
      reviewResolutionId: resolution.id,
      normalVotes: 1,
      abnormalVotes: 0,
      patientId: patientId(4),
      studyId: studyId(4),
      seriesId: seriesId(4),
      fileSha256: sha(fileBytes(9)),
      fileSize: String(fileBytes(9).length),
    });
    // Implicit NORMAL of a completed Series review (no vote rows).
    expect(await item(4)).toMatchObject({
      label: 'NORMAL',
      reviewStateSourceAtSnapshot: 'FINISH_REVIEW',
      reviewCompletionId: null,
      reviewResolutionId: null,
      normalVotes: 0,
      implicitNormals: 1,
    });
    expect(await item(1)).toMatchObject({ reviewStateSourceAtSnapshot: 'VOTES', normalVotes: 1, implicitNormals: 0 });
    const [stored] = await rows(`SELECT * FROM dataset_snapshots WHERE id = $1`, [snapshot.id]);
    expect(stored).toMatchObject({
      createdById: 'sub-admin',
      createdByName: 'Admin',
      finalizedById: 'sub-final',
      finalizedByName: 'Finalizer',
      datasetSchemaVersion: 1,
      splitSeed: 'fixed-seed-1',
      configuration: expect.objectContaining({ datasetSchemaVersion: 1, finalizationFileVerification: 'SHA256_REHASHED' }),
    });
  });

  it('finalized membership does not change after review changes, imports and trash', async () => {
    const snapshot = await draft(SEED);
    await finalizeFrozen(snapshot.id);
    const before = await membership(snapshot.id);
    await review.unfreezeReview(ADMIN);

    await review.castVote(imageId(1), reviewer('z'), { vote: Vote.ABNORMAL }); // now CONFLICTED
    await review.setResolution(imageId(6), ADMIN, { label: ReviewResolutionLabel.NORMAL });
    await review.removeResolution(imageId(9), ADMIN);
    await addImage({ n: 40, patient: 1, state: 'NORMAL_VOTE' }); // a new image in an included series
    await review.castVote(imageId(40), reviewer('a'), { vote: Vote.NORMAL });
    await sequelize.query(`UPDATE patients SET "deletedAt" = now() WHERE id = $1`, { bind: [patientId(3)] });

    expect(await membership(snapshot.id)).toEqual(before);
  });

  it('the database refuses any change to finalized data; archiving is the only transition', async () => {
    const snapshot = await draft(SEED);
    await finalizeFrozen(snapshot.id);
    const refused = { parent: { code: '55000' } };
    await expect(sequelize.query(`UPDATE dataset_snapshot_items SET label = 'NORMAL'`)).rejects.toMatchObject(refused);
    await expect(sequelize.query(`DELETE FROM dataset_snapshot_items`)).rejects.toMatchObject(refused);
    await expect(sequelize.query(`DELETE FROM dataset_snapshot_exclusions`)).rejects.toMatchObject(refused);
    await expect(sequelize.query(`UPDATE dataset_snapshot_patients SET split = 'TEST'`)).rejects.toMatchObject(refused);
    await expect(sequelize.query(`UPDATE dataset_snapshots SET name = 'renamed'`)).rejects.toMatchObject(refused);
    await expect(sequelize.query(`DELETE FROM dataset_snapshots`)).rejects.toMatchObject(refused);
    await expect(snapshots.deleteDraft(snapshot.id)).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_DRAFT' });
    await expect(snapshots.updateDraft(snapshot.id, { name: 'x' })).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_DRAFT' });
    await expect(finalizeFrozen(snapshot.id)).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_DRAFT' });

    const archived = await snapshots.archiveSnapshot(snapshot.id, ADMIN);
    expect(archived).toMatchObject({ status: 'ARCHIVED', archivedByName: 'Admin', totalImages: 16 });
    await expect(snapshots.archiveSnapshot(snapshot.id, ADMIN)).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FINALIZED' });
    await expect(sequelize.query(`UPDATE dataset_snapshots SET status = 'FINALIZED'`)).rejects.toMatchObject(refused);
  });

  it('a DRAFT can be deleted', async () => {
    const snapshot = await draft(SEED);
    await snapshots.deleteDraft(snapshot.id);
    await expect(snapshots.getSnapshot(snapshot.id)).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_FOUND', status: 404 });
  });

  // --- Freeze races -------------------------------------------------------------------------

  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
  };
  const settlesWithin = (promise: Promise<unknown>, ms: number) =>
    Promise.race([
      promise.then(() => true, () => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
    ]);

  /** Pauses the finalization right before its last insert (inside the transaction). */
  const pauseFinalization = () => {
    const { DatasetSnapshotExclusion } = require('../../db/models/DatasetSnapshot.model');
    const reached = gate();
    const release = gate();
    const original = DatasetSnapshotExclusion.bulkCreate.bind(DatasetSnapshotExclusion);
    const spy = jest.spyOn(DatasetSnapshotExclusion, 'bulkCreate').mockImplementation((async (...args: unknown[]) => {
      reached.open();
      await release.opened;
      return original(...args);
    }) as never);
    return { reached, release, restore: () => spy.mockRestore() };
  };

  it('while frozen a review mutation is refused outright', async () => {
    await review.freezeReview(ADMIN, 'dataset');
    await expect(review.castVote(imageId(1), reviewer('z'), { vote: Vote.ABNORMAL })).rejects.toMatchObject({
      code: 'REVIEW_FROZEN',
    });
  });

  it('during the capture label mutations are refused at once; viewing and other writes work; then released', async () => {
    const snapshot = await draft(SEED);
    const pause = pauseFinalization();
    const finalizing = snapshots.finalizeSnapshot(snapshot.id, ADMIN);
    await pause.reached.opened; // inside the capture: exclusive lock held

    const locked = { code: 'REVIEW_LOCKED', status: 409 };
    await expect(review.castVote(imageId(1), reviewer('z'), { vote: Vote.ABNORMAL })).rejects.toMatchObject(locked);
    await expect(
      review.castBulkVote(patientId(1), seriesId(1), reviewer('z'), [imageId(2), imageId(3)], Vote.ABNORMAL)
    ).rejects.toMatchObject(locked);
    await expect(
      review.completeSeriesReview(patientId(6), seriesId(6), reviewer('z'), [imageId(15), imageId(16)])
    ).rejects.toMatchObject(locked);
    // Reads (the viewer) and non-label writes are not blocked.
    const { getPatientSeries } = require('../hierarchy.service');
    expect(await getPatientSeries(patientId(1), seriesId(1))).toMatchObject({ images: expect.any(Array) });
    await sequelize.query(`UPDATE patients SET notes = 'edited during capture' WHERE id = $1`, { bind: [patientId(2)] });

    pause.release.open();
    await expect(finalizing).resolves.toMatchObject({ status: 'FINALIZED' });
    pause.restore();

    // Released immediately after the snapshot was captured.
    await review.castVote(imageId(1), reviewer('z'), { vote: Vote.ABNORMAL });
    expect(await rows(`SELECT "reviewState" FROM patients_images WHERE id = $1`, [imageId(1)])).toEqual([
      { reviewState: 'CONFLICTED' },
    ]);
    // The snapshot keeps image 1 as captured (NORMAL, one vote).
    expect(
      await rows(`SELECT label, "normalVotes", "abnormalVotes" FROM dataset_snapshot_items WHERE "patientImageId" = $1`, [imageId(1)])
    ).toEqual([{ label: 'NORMAL', normalVotes: 1, abnormalVotes: 0 }]);
  });

  it('the capture waits for a label mutation in flight and includes it; newer ones are refused meanwhile', async () => {
    const snapshot = await draft(SEED);
    const release = gate();
    const locked = gate();
    const inFlight = sequelize.transaction(async (transaction) => {
      await review.acquireReviewMutationLock(transaction);
      await sequelize.query(
        `INSERT INTO patient_image_review_votes (id, "patientImageId", "reviewerId", "reviewerName", vote, "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, 'sub-x', 'X', 'abnormal', now(), now())`,
        { bind: [imageId(1)], transaction }
      );
      await review.recomputeReviewCaches([imageId(1)], transaction);
      locked.open();
      await release.opened;
    });
    await locked.opened;

    const finalizing = snapshots.finalizeSnapshot(snapshot.id, ADMIN);
    expect(await settlesWithin(finalizing, 1500)).toBe(false); // waits for the mutation
    // While the capture waits, new label mutations are refused (no starvation).
    await expect(review.castVote(imageId(2), reviewer('z'), { vote: Vote.ABNORMAL })).rejects.toMatchObject({
      code: 'REVIEW_LOCKED',
    });

    release.open();
    await inFlight;
    await expect(finalizing).resolves.toMatchObject({ status: 'FINALIZED' });
    // Image 1 was captured with the committed mutation: NORMAL + ABNORMAL.
    expect(await rows(`SELECT reason FROM dataset_snapshot_exclusions WHERE "patientImageId" = $1`, [imageId(1)])).toEqual([
      { reason: 'CONFLICTED' },
    ]);
  });

  it('a failed capture publishes nothing and leaves no lock or freeze behind; it can be retried', async () => {
    const snapshot = await draft(SEED);
    const { DatasetSnapshotExclusion } = require('../../db/models/DatasetSnapshot.model');
    const spy = jest.spyOn(DatasetSnapshotExclusion, 'bulkCreate').mockRejectedValueOnce(new Error('disk full'));
    await expect(snapshots.finalizeSnapshot(snapshot.id, ADMIN)).rejects.toThrow('disk full');
    spy.mockRestore();

    expect((await snapshots.getSnapshot(snapshot.id)).status).toBe('DRAFT');
    expect(await count('dataset_snapshot_items')).toBe(0);
    expect(await count('dataset_snapshot_patients')).toBe(0);
    expect(await count('dataset_snapshot_exclusions')).toBe(0);
    expect(await count('review_freezes')).toBe(0);
    // Not locked: a vote goes through at once.
    await review.castVote(imageId(2), reviewer('z'), { vote: Vote.NORMAL });

    await expect(snapshots.finalizeSnapshot(snapshot.id, ADMIN)).resolves.toMatchObject({ status: 'FINALIZED' });
  });

  it('an active manual freeze is kept and recorded as the capture freeze', async () => {
    const snapshot = await draft(SEED);
    await review.freezeReview(ADMIN, 'dataset');
    const result = await snapshots.finalizeSnapshot(snapshot.id, ADMIN);
    const [{ id }] = await rows(`SELECT id FROM review_freezes WHERE "unfrozenAt" IS NULL`);
    expect(result.reviewFreezeId).toBe(id);
    expect(await count('review_freezes')).toBe(1);
    expect(await review.getReviewFreezeState()).toMatchObject({ frozen: true });
  });

  it('two concurrent finalizations: exactly one succeeds', async () => {
    const snapshot = await draft(SEED);
    const pause = pauseFinalization();
    const first = snapshots.finalizeSnapshot(snapshot.id, ADMIN);
    await pause.reached.opened;
    pause.restore();
    const second = snapshots.finalizeSnapshot(snapshot.id, ADMIN);
    expect(await settlesWithin(second, 300)).toBe(false); // waits for the capture lock
    pause.release.open();
    await expect(first).resolves.toMatchObject({ status: 'FINALIZED' });
    await expect(second).rejects.toMatchObject({ code: 'SNAPSHOT_NOT_DRAFT' });
    expect(await count('dataset_snapshot_items')).toBe(16);
  });

  // --- HTTP ------------------------------------------------------------------------------------

  describe('HTTP API', () => {
    let server: Server;
    let base: string;
    const fakeKeycloak = {
      protect:
        (...roles: string[]) =>
        (req: express.Request, res: express.Response, next: express.NextFunction) => {
          const user = req.header('x-test-user');
          if (!user) return void res.status(401).end();
          if (roles.length && !roles.some((role) => (req.header('x-test-roles') ?? '').split(',').includes(role))) {
            return void res.status(403).end();
          }
          (req as unknown as { kauth: unknown }).kauth = {
            grant: { access_token: { content: { sub: `sub-${user}`, name: `User ${user}` } } },
          };
          next();
        },
    };

    beforeAll(async () => {
      const { setupAPIRoutes } = require('../../api/v1/api') as typeof ApiModule;
      const app = express();
      app.use(express.json());
      setupAPIRoutes(app, fakeKeycloak as never);
      server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    const call = (method: string, url: string, body?: unknown, roles = 'dashboard:admin') =>
      fetch(`${base}${url}`, {
        method,
        headers: {
          'x-test-user': 'admin',
          'x-test-roles': roles,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it('every route is admin-only', async () => {
      const id = uuid('9', 1);
      for (const [method, url] of [
        ['GET', '/dataset-snapshots'],
        ['POST', '/dataset-snapshots'],
        ['GET', `/dataset-snapshots/${id}`],
        ['PATCH', `/dataset-snapshots/${id}`],
        ['DELETE', `/dataset-snapshots/${id}`],
        ['POST', `/dataset-snapshots/${id}/preview`],
        ['POST', `/dataset-snapshots/${id}/finalize`],
        ['POST', `/dataset-snapshots/${id}/archive`],
        ['GET', `/dataset-snapshots/${id}/items`],
      ]) {
        const response = await call(method, url, method === 'GET' || method === 'DELETE' ? undefined : { name: 'x' }, 'doctor');
        expect([method, url, response.status]).toEqual([method, url, 403]);
      }
    });

    it('create, preview, finalize, items: no source, path, file name, UID or PHI; hashes only in the manifest', async () => {
      const created = await call('POST', '/dataset-snapshots', { name: 'CT v1', configuration: SEED });
      expect(created.status).toBe(200);
      const { id } = await created.json();
      const previewText = await (await call('POST', `/dataset-snapshots/${id}/preview`)).text();
      // No manual freeze needed: the labels are captured under a short lock.
      const finalized = await call('POST', `/dataset-snapshots/${id}/finalize`);
      expect(finalized.status).toBe(200);
      const again = await call('POST', `/dataset-snapshots/${id}/finalize`);
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ code: 'SNAPSHOT_NOT_DRAFT' });
      const summaryText = await finalized.text();
      const listText = await (await call('GET', '/dataset-snapshots')).text();
      const itemsResponse = await call('GET', `/dataset-snapshots/${id}/items?limit=5`);
      const items = await itemsResponse.json();

      for (const body of [previewText, summaryText, listText, JSON.stringify(items)]) {
        expect(body).not.toMatch(/uploads|Doe_John|"source"|\.dcm/);
        expect(body).not.toContain(UID_PREFIX);
        expect(body).not.toContain('Synthetic'); // patient name
      }
      for (const body of [previewText, summaryText, listText]) {
        expect(body).not.toMatch(/[0-9a-f]{64}/);
      }
      expect(items.items).toHaveLength(5);
      expect(items.items[0]).toMatchObject({ fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(items.next).toBe(items.items[4].patientImageId);
      const rest = await (await call('GET', `/dataset-snapshots/${id}/items?after=${items.next}`)).json();
      expect(items.items.length + rest.items.length).toBe(16);
      expect(rest.next).toBeNull();
    });

    it('unknown and malformed ids are 404; invalid bodies 400', async () => {
      expect((await call('GET', `/dataset-snapshots/${uuid('9', 2)}`)).status).toBe(404);
      expect((await call('GET', '/dataset-snapshots/not-a-uuid')).status).toBe(404);
      expect((await call('POST', `/dataset-snapshots/${uuid('9', 2)}/preview`)).status).toBe(404);
      expect((await call('POST', '/dataset-snapshots', { name: 'x', configuration: { split: { train: 0.9, validation: 0.2, test: 0.1 } } })).status).toBe(400);
      expect((await call('POST', '/dataset-snapshots', {})).status).toBe(400);
    });

    it('permanent deletion of a patient in a finalized snapshot is 409 PATIENT_IN_DATASET_SNAPSHOT', async () => {
      const snapshot = await draft(SEED);
      const other = await draft(SEED); // stays a DRAFT: never blocks
      void other;
      await finalizeFrozen(snapshot.id);
      await review.unfreezeReview(ADMIN);

      const response = await call('POST', `/patients/${patientId(1)}/trash?type=delete`);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'PATIENT_IN_DATASET_SNAPSHOT',
        snapshots: [{ id: snapshot.id, name: 'CT v1' }],
      });
      expect(await rows(`SELECT id FROM patients WHERE id = $1`, [patientId(1)])).toHaveLength(1);
      // The FK is the database backstop.
      await expect(sequelize.query(`DELETE FROM patients WHERE id = $1`, { bind: [patientId(1)] })).rejects.toMatchObject({
        parent: { code: '23503', constraint: 'dataset_snapshot_items_patientImageId_fkey' },
      });
      // A patient only excluded (trashed P9) or only in drafts can be deleted.
      expect((await call('POST', `/patients/${patientId(9)}/trash?type=delete`)).status).toBe(200);
      expect(await rows(`SELECT reason FROM dataset_snapshot_exclusions WHERE "patientImageId" = $1`, [imageId(21)])).toEqual([
        { reason: 'PATIENT_TRASHED' },
      ]);
    });
  });
});
