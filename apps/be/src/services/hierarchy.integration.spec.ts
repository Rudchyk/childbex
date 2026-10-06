/**
 * Patient -> Study -> Series API and Series "Finish review" against
 * PostgreSQL (and over HTTP with a fake Keycloak): ownership isolation,
 * ordering, review summaries, broken images, reviewability of a Series as
 * one stack (orientation, geometry, multi-frame), completion provenance,
 * LLM check ownership and the removed cluster API. Synthetic data only.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_navigation" (created when missing); every
 * test recreates its `public` schema.
 */
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import {
  PatientImageReviewVoteTypes as Vote,
  ReviewResolutionLabel,
  type StudySeriesResponse,
} from '@libs/schemas';
import type * as MigratorModule from '../db/migrator';
import type * as ReviewModule from './review.service';
import type * as HierarchyModule from './hierarchy.service';
import type * as ApiModule from '../api/v1/api';

jest.mock('./logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL hierarchy tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

// --- Synthetic fixture ----------------------------------------------------------
const P1 = '11111111-1111-4111-8111-000000000001';
const P2 = '11111111-1111-4111-8111-000000000002';
const ST1 = '44444444-4444-4444-8444-000000000001'; // P1, 2026-01-02
const ST2 = '44444444-4444-4444-8444-000000000002'; // P1, 2025-05-06
const ST3 = '44444444-4444-4444-8444-000000000003'; // P2
const SE_AX = '55555555-5555-4555-8555-000000000001'; // ST1 #2, axial stack + broken
const SE_MIX = '55555555-5555-4555-8555-000000000002'; // ST1 #1, axial + sagittal
const SE_MF = '55555555-5555-4555-8555-000000000003'; // ST1 #3, multi-frame
const SE_OTHER = '55555555-5555-4555-8555-000000000004'; // ST2
const SE_P2 = '55555555-5555-4555-8555-000000000005'; // ST3 (P2)
const SE_GEO = '55555555-5555-4555-8555-000000000006'; // ST3 (P2), mixed geometry
const SE_INC = '55555555-5555-4555-8555-000000000007'; // ST3 (P2), incomplete geometry
const img = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const AXIAL = [1, 0, 0, 0, 1, 0];
const SAGITTAL = [0, 1, 0, 0, 0, -1];
/** Values that must never appear in API responses. */
const STUDY_UID = '2.25.9000001';
const SOP_PREFIX = '2.25.7000';
const HASH = 'f'.repeat(64);

interface ImageFixture {
  n: number;
  series: string;
  instance?: number | null;
  rows?: number;
  pixelSpacing?: number[] | null;
  iop?: number[] | null;
  z?: number;
  frames?: number;
  broken?: boolean;
}

/** Axial stack inserted in a shuffled order; positions differ from instance order. */
const images: ImageFixture[] = [
  { n: 3, series: SE_AX, instance: 1, z: 30 },
  { n: 1, series: SE_AX, instance: 3, z: -10 },
  { n: 2, series: SE_AX, instance: 2, z: 5 },
  { n: 4, series: SE_AX, instance: 4, z: 5 }, // same position as 2: instance breaks the tie
  { n: 5, series: SE_AX, instance: 9, broken: true },
  { n: 10, series: SE_MIX, instance: 1, z: 0 },
  { n: 11, series: SE_MIX, instance: 2, iop: SAGITTAL, z: 0 },
  { n: 20, series: SE_MF, instance: 1, z: 0, frames: 40 },
  { n: 30, series: SE_OTHER, instance: 1, z: 0 },
  { n: 50, series: SE_P2, instance: 1, z: 0 },
  // Formerly a geometry outlier: another matrix size in the same series.
  { n: 60, series: SE_GEO, instance: 1, z: 0 },
  { n: 61, series: SE_GEO, instance: 2, z: 1, rows: 256 },
  // An image without pixel spacing: incomplete geometry.
  { n: 70, series: SE_INC, instance: 1, z: 0 },
  { n: 71, series: SE_INC, instance: 2, z: 1, pixelSpacing: null },
];

describeWithDatabase('Study/Series hierarchy (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let review: typeof ReviewModule;
  let hierarchy: typeof HierarchyModule;
  let tmp: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_navigation`;
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
    process.env.UPLOAD_ROOT = path.join(tmp, 'uploads');
    process.env.UPLOAD_SESSIONS_DIR = path.join(tmp, 'sessions');
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    // patients.service first: it and the models import each other.
    require('./patients.service');
    ({ sequelize } = require('../db/sequelize'));
    migrator = require('../db/migrator');
    review = require('./review.service');
    hierarchy = require('./hierarchy.service');
  });

  const insertFixture = async () => {
    for (const [id, slug] of [[P1, 'patient-one'], [P2, 'patient-two']]) {
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now())`,
        { bind: [id, slug] }
      );
    }
    for (const [id, patient, uid, date, time] of [
      [ST1, P1, STUDY_UID, '2026-01-02', '101500'],
      [ST2, P1, '2.25.9000002', '2025-05-06', null],
      [ST3, P2, '2.25.9000003', '2026-02-03', null],
    ]) {
      await sequelize.query(
        `INSERT INTO studies (id, "patientId", "studyInstanceUid", "studyDate", "studyTime", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        { bind: [id, patient, uid, date, time] }
      );
    }
    for (const [id, study, number, description] of [
      [SE_AX, ST1, 2, 'AXIAL STACK'],
      [SE_MIX, ST1, 1, 'LOCALIZER'],
      [SE_MF, ST1, 3, 'MULTIFRAME'],
      [SE_OTHER, ST2, null, null],
      [SE_P2, ST3, 1, 'OTHER PATIENT'],
      [SE_GEO, ST3, 2, 'MIXED GEOMETRY'],
      [SE_INC, ST3, 3, 'INCOMPLETE GEOMETRY'],
    ] as const) {
      await sequelize.query(
        `INSERT INTO series (id, "studyId", "seriesInstanceUid", "seriesNumber", "seriesDescription", modality, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'CT', now(), now())`,
        { bind: [id, study, `2.25.8${id.slice(-4)}`, number, description] }
      );
    }
    for (const image of images) {
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "seriesId", "isBrocken", status, notes,
           "instanceNumber", "imageOrientationPatient", "imagePositionPatient", "numberOfFrames",
           "sopInstanceUid", "studyInstanceUid", "fileSha256", rows, columns, "pixelSpacing",
           "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())`,
        {
          bind: [
            img(image.n),
            `/uploads/${P1}/${image.series}/IM${image.n}`,
            image.series,
            !!image.broken,
            image.broken ? 'broken' : 'not_reviewed',
            image.broken ? 'pixeldata_truncated' : null,
            image.instance ?? null,
            image.broken ? null : image.iop ?? AXIAL,
            image.broken ? null : [0, 0, image.z ?? 0],
            image.frames ?? (image.broken ? null : 1),
            `${SOP_PREFIX}${image.n}`,
            STUDY_UID,
            HASH,
            image.broken ? null : image.rows ?? 512,
            image.broken ? null : 512,
            image.broken || image.pixelSpacing === null ? null : image.pixelSpacing ?? [0.7, 0.7],
          ],
        }
      );
    }
  };

  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrator.migrateUp(sequelize);
    await insertFixture();
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  const rows = (sql: string, bind: unknown[] = []) =>
    sequelize.query<Record<string, unknown>>(sql, { bind, type: QueryTypes.SELECT });
  const reviewer = (name: string) => ({ id: `sub-${name}`, name: `Reviewer ${name}` });
  const ADMIN = { id: 'sub-admin', name: 'Admin' };
  const AX_DISPLAYED = [img(1), img(2), img(4), img(3)];
  const reviewSnapshot = async () => ({
    images: await rows(
      `SELECT id, "reviewState", "reviewStateSource", status::text AS status, "isAbnormal",
              "votesCount", "updatedAt" FROM patients_images ORDER BY id`
    ),
    votes: await rows('SELECT * FROM patient_image_review_votes ORDER BY id'),
    resolutions: await rows('SELECT * FROM patient_image_review_resolutions ORDER BY id'),
    completions: await rows('SELECT * FROM patient_image_review_completions ORDER BY id'),
    seriesCompletions: await rows('SELECT * FROM series_review_completions ORDER BY id'),
  });

  // --- Hierarchy reads ---------------------------------------------------------------

  describe('studies and series', () => {
    it("lists only the patient's studies, with summaries", async () => {
      const result = await hierarchy.getPatientStudies(P1);
      expect(result).toEqual({
        patientId: P1,
        studies: [
          {
            id: ST2,
            studyDate: '2025-05-06',
            studyTime: null,
            seriesCount: 1,
            imageCount: 1,
            review: { total: 1, broken: 0, notReviewed: 1, normal: 0, abnormal: 0, uncertain: 0, conflicted: 0 },
          },
          {
            id: ST1,
            studyDate: '2026-01-02',
            studyTime: '101500',
            seriesCount: 3,
            imageCount: 8,
            review: { total: 8, broken: 1, notReviewed: 7, normal: 0, abnormal: 0, uncertain: 0, conflicted: 0 },
          },
        ],
      });
      expect((await hierarchy.getPatientStudies(P2))?.studies.map(({ id }) => id)).toEqual([ST3]);
    });

    it('lists the series of a study (by series number) with structure flags', async () => {
      const result = await hierarchy.getStudySeries(P1, ST1);
      expect(result?.study.id).toBe(ST1);
      expect(
        result?.series.map(({ id, seriesNumber, imageCount, orientationCount, multiFrameImageCount }) => ({
          id, seriesNumber, imageCount, orientationCount, multiFrameImageCount,
        }))
      ).toEqual([
        { id: SE_MIX, seriesNumber: 1, imageCount: 2, orientationCount: 2, multiFrameImageCount: 0 },
        { id: SE_AX, seriesNumber: 2, imageCount: 5, orientationCount: 1, multiFrameImageCount: 0 },
        { id: SE_MF, seriesNumber: 3, imageCount: 1, orientationCount: 1, multiFrameImageCount: 1 },
      ]);
      expect(result?.series[1]).toMatchObject({
        studyId: ST1,
        seriesDescription: 'AXIAL STACK',
        modality: 'CT',
        review: { total: 5, broken: 1, notReviewed: 4 },
      });
    });

    it('returns the series images in deterministic geometric order, broken last', async () => {
      const result = await hierarchy.getPatientSeries(P1, SE_AX);
      expect(result?.images.map(({ id, instanceNumber, orientationGroup, isBroken }) => [id, instanceNumber, orientationGroup, isBroken])).toEqual([
        [img(1), 3, 0, false], // z = -10
        [img(2), 2, 0, false], // z = 5, instance 2
        [img(4), 4, 0, false], // z = 5, instance 4
        [img(3), 1, 0, false], // z = 30
        [img(5), 9, null, true],
      ]);
      expect(result?.images[4]).toMatchObject({ brokenReason: 'pixeldata_truncated' });
      expect(result?.images[0]).toMatchObject({
        fileUrl: `/patients/${P1}/images/${img(1)}/file`,
        reviewState: 'NOT_REVIEWED',
        reviewStateSource: 'NONE',
        status: 'not_reviewed',
        votes: [],
        implicitNormals: [],
      });
      expect(result).toMatchObject({
        patient: { id: P1, slug: 'patient-one' },
        study: { id: ST1, studyDate: '2026-01-02', studyTime: '101500' },
        // Revision of the non-broken image set; nobody completed it yet.
        review: {
          imageSetRevision: createHash('sha256').update([...AX_DISPLAYED].sort().join('\n')).digest('hex'),
          completions: [],
        },
      });
      // Same result on every call.
      expect(await hierarchy.getPatientSeries(P1, SE_AX)).toEqual(result);
    });

    it('summaries follow the effective review state (broken apart, never isAbnormal)', async () => {
      await review.castVote(img(1), reviewer('a'), { vote: Vote.ABNORMAL });
      await review.castVote(img(2), reviewer('a'), { vote: Vote.NORMAL });
      await review.castVote(img(2), reviewer('b'), { vote: Vote.ABNORMAL });
      await review.castVote(img(3), reviewer('a'), { vote: Vote.UNCERTAIN });
      await review.setResolution(img(4), ADMIN, { label: ReviewResolutionLabel.NORMAL });
      // A stale compatibility cache must not count.
      await sequelize.query(`UPDATE patients_images SET "isAbnormal" = true WHERE id = $1`, { bind: [img(3)] });

      const series = (await hierarchy.getPatientSeries(P1, SE_AX))?.series;
      expect(series?.review).toEqual({ total: 5, broken: 1, notReviewed: 0, normal: 1, abnormal: 1, uncertain: 1, conflicted: 1 });
      const study = (await hierarchy.getPatientStudies(P1))?.studies.find(({ id }) => id === ST1);
      expect(study?.review).toMatchObject({ total: 8, broken: 1, notReviewed: 3, normal: 1, abnormal: 1, uncertain: 1, conflicted: 1 });
      const image2 = (await hierarchy.getPatientSeries(P1, SE_AX))?.images.find(({ id }) => id === img(2));
      expect(image2).toMatchObject({ reviewState: 'CONFLICTED', reviewStateSource: 'VOTES' });
      expect(image2?.votes.map(({ reviewerId, vote }) => [reviewerId, vote])).toEqual([
        ['sub-a', 'normal'],
        ['sub-b', 'abnormal'],
      ]);
    });

    it('never crosses patients: foreign, unknown and trashed are all not found', async () => {
      expect(await hierarchy.getStudySeries(P1, ST3)).toBeNull(); // P2's study
      expect(await hierarchy.getStudySeries(P2, ST1)).toBeNull();
      expect(await hierarchy.getPatientSeries(P1, SE_P2)).toBeNull(); // P2's series
      expect(await hierarchy.getPatientSeries(P2, SE_AX)).toBeNull();
      expect(await hierarchy.getPatientSeries(P1, '55555555-5555-4555-8555-999999999999')).toBeNull();
      expect(await hierarchy.getPatientSeries(P1, 'not-a-uuid')).toBeNull();
      await sequelize.query(`UPDATE patients SET "deletedAt" = now() WHERE id = $1`, { bind: [P1] });
      expect(await hierarchy.getPatientStudies(P1)).toBeNull();
      expect(await hierarchy.getPatientSeries(P1, SE_AX)).toBeNull();
    });

    it('reports the readiness of each series (server-derived, the Finish review rule)', async () => {
      const flags = (series: StudySeriesResponse['series'] | undefined) =>
        series?.map(({ id, orientationCount, multiFrameImageCount, geometryCount, geometryIncompleteCount, reviewable }) => ({
          id, orientationCount, multiFrameImageCount, geometryCount, geometryIncompleteCount, reviewable,
        }));
      expect(flags((await hierarchy.getStudySeries(P1, ST1))?.series)).toEqual([
        { id: SE_MIX, orientationCount: 2, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: false },
        { id: SE_AX, orientationCount: 1, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: true },
        { id: SE_MF, orientationCount: 1, multiFrameImageCount: 1, geometryCount: 1, geometryIncompleteCount: 0, reviewable: false },
      ]);
      expect(flags((await hierarchy.getStudySeries(P2, ST3))?.series)).toEqual([
        { id: SE_P2, orientationCount: 1, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: true },
        { id: SE_GEO, orientationCount: 1, multiFrameImageCount: 0, geometryCount: 2, geometryIncompleteCount: 0, reviewable: false },
        // The known geometry combinations count as one: still not reviewable.
        { id: SE_INC, orientationCount: 1, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 1, reviewable: false },
      ]);
    });

    it('reading changes no review data', async () => {
      const before = await reviewSnapshot();
      await hierarchy.getPatientStudies(P1);
      await hierarchy.getStudySeries(P1, ST1);
      for (const series of [SE_AX, SE_MIX, SE_MF, SE_OTHER]) await hierarchy.getPatientSeries(P1, series);
      expect(await reviewSnapshot()).toEqual(before);
    });
  });

  // --- Series Complete review -------------------------------------------------------

  describe('Series complete review', () => {
    it('records the reviewer\x27s image set; unvoted images become their implicit NORMAL (no vote rows)', async () => {
      await review.castVote(img(1), reviewer('a'), { vote: Vote.ABNORMAL });
      await review.castVote(img(2), reviewer('a'), { vote: Vote.NORMAL });
      await review.castVote(img(2), reviewer('b'), { vote: Vote.ABNORMAL });
      await review.setResolution(img(4), ADMIN, { label: ReviewResolutionLabel.UNCERTAIN });
      const before = await reviewSnapshot();

      const result = await review.completeSeriesReview(P1, SE_AX, reviewer('f'), AX_DISPLAYED);

      const sorted = [...AX_DISPLAYED].sort();
      expect(result).toEqual({
        completionId: expect.any(String),
        completedAt: expect.any(String),
        imageSetRevision: createHash('sha256').update(sorted.join('\n')).digest('hex'),
        imageCount: AX_DISPLAYED.length,
        explicitAbnormal: 0,
        explicitUncertain: 0,
        explicitNormal: 0,
        implicitNormal: AX_DISPLAYED.length,
        skippedBroken: 1,
      });
      expect(await rows(`SELECT "seriesId", "reviewerId", "reviewerName", "imageIds", "imageCount", "imageSetHash" FROM series_review_completions`)).toEqual([
        { seriesId: SE_AX, reviewerId: 'sub-f', reviewerName: 'Reviewer f', imageIds: sorted, imageCount: AX_DISPLAYED.length, imageSetHash: result.imageSetRevision },
      ]);
      // No per-image rows of any kind are created.
      expect(await rows('SELECT 1 FROM patient_image_review_completions')).toHaveLength(0);
      const state = async (n: number) =>
        (await rows(`SELECT "reviewState", "reviewStateSource" FROM patients_images WHERE id = $1`, [img(n)]))[0];
      expect(await state(3)).toEqual({ reviewState: 'NORMAL', reviewStateSource: 'FINISH_REVIEW' });
      // A's explicit ABNORMAL vs f's implicit NORMAL: a disagreement.
      expect(await state(1)).toEqual({ reviewState: 'CONFLICTED', reviewStateSource: 'VOTES' });
      expect(await state(2)).toEqual({ reviewState: 'CONFLICTED', reviewStateSource: 'VOTES' });
      expect(await state(4)).toEqual({ reviewState: 'UNCERTAIN', reviewStateSource: 'RESOLUTION' });
      expect(await state(5)).toEqual({ reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE' }); // broken
      // Other series: untouched.
      for (const n of [10, 11, 20, 30, 50]) {
        expect(await state(n)).toEqual({ reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE' });
      }
      const after = await reviewSnapshot();
      expect(after.votes).toEqual(before.votes);
      expect(after.resolutions).toEqual(before.resolutions);

      // Another reviewer's later vote disagrees with f's implicit NORMAL.
      await review.castVote(img(3), reviewer('b'), { vote: Vote.ABNORMAL });
      expect(await state(3)).toEqual({ reviewState: 'CONFLICTED', reviewStateSource: 'VOTES' });
      // f changes their own mind later: no reopen needed, the vote wins.
      await review.castVote(img(3), reviewer('f'), { vote: Vote.ABNORMAL });
      expect(await state(3)).toEqual({ reviewState: 'ABNORMAL', reviewStateSource: 'VOTES' });
      expect(await rows('SELECT 1 FROM series_review_completions')).toHaveLength(1);
    });

    it.each([
      ['mixed orientations', P1, SE_MIX, [img(10), img(11)]],
      ['a multi-frame image', P1, SE_MF, [img(20)]],
      ['mixed geometry (a former geometry outlier)', P2, SE_GEO, [img(60), img(61)]],
      ['incomplete geometry', P2, SE_INC, [img(70), img(71)]],
    ])('refuses a series with %s (SERIES_NOT_FULLY_REVIEWABLE), changing nothing', async (_, patient, series, presented) => {
      const before = await reviewSnapshot();
      await expect(
        review.completeSeriesReview(patient, series, reviewer('f'), presented)
      ).rejects.toMatchObject({ code: 'SERIES_NOT_FULLY_REVIEWABLE', status: 409 });
      expect(await reviewSnapshot()).toEqual(before);
    });

    it.each([
      ['one image missing', AX_DISPLAYED.slice(1)],
      ['an extra image', [...AX_DISPLAYED, img(30)]],
      ['the broken image included', [...AX_DISPLAYED, img(5)]],
      ['nothing presented', []],
    ])('refuses when the presented images differ (%s): SERIES_CHANGED', async (_, presented) => {
      const before = await reviewSnapshot();
      await expect(
        review.completeSeriesReview(P1, SE_AX, reviewer('f'), presented)
      ).rejects.toMatchObject({ code: 'SERIES_CHANGED', status: 409 });
      expect(await reviewSnapshot()).toEqual(before);
    });

    it('is not found for another patient and refused while frozen', async () => {
      await expect(
        review.completeSeriesReview(P2, SE_AX, reviewer('f'), AX_DISPLAYED)
      ).rejects.toMatchObject({ code: 'SERIES_NOT_FOUND', status: 404 });
      await review.freezeReview(ADMIN, 'export');
      await expect(
        review.completeSeriesReview(P1, SE_AX, reviewer('f'), AX_DISPLAYED)
      ).rejects.toMatchObject({ code: 'REVIEW_FROZEN' });
      expect(await rows('SELECT 1 FROM series_review_completions')).toHaveLength(0);
    });

    it('exactly one completion scope (CHECK)', async () => {
      const insert = (cluster: string | null, series: string | null) =>
        sequelize.query(
          `INSERT INTO patient_image_review_completions (id, "patientImageId", "runId", "legacyScopeClusterId", "scopeSeriesId", "completedById", "completedByName", "createdAt")
           VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, $3, 'u', 'U', now())`,
          { bind: [img(30), cluster, series] }
        );
      for (const [cluster, series] of [['22222222-2222-4222-8222-000000000001', SE_OTHER], [null, null]]) {
        await expect(insert(cluster, series)).rejects.toMatchObject({
          parent: { code: '23514', constraint: 'patient_image_review_completions_one_scope' },
        });
      }
    });
  });

  // --- Readiness query ------------------------------------------------------------

  it('the read-only readiness query reports counts only, matching the API', async () => {
    const sql = await readFile(path.join(__dirname, '../db/queries/series-readiness.sql'), 'utf8');
    const [result] = await rows(sql);
    expect(result).toEqual({
      series: 7,
      seriesWithSeveralOrientations: 1,
      seriesWithMultiFrameImages: 1,
      imagesWithoutSeries: 0,
      brokenImagesWithoutSeries: 0,
      brokenImagesInSeries: 1,
    });
  });

  // --- HTTP ------------------------------------------------------------------------

  describe('HTTP API', () => {
    let server: Server;
    let origin: string;
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
            // Token roles: the test header, else a doctor (realm role).
            grant: { access_token: { content: { sub: `sub-${user}`, name: `User ${user}`, realm_access: { roles: (req.header('x-test-roles') ?? 'doctor').split(',') } } } },
          };
          next();
        },
    };

    beforeAll(async () => {
      const { setupAPIRoutes } = require('../api/v1/api') as typeof ApiModule;
      const app = express();
      app.use(express.json());
      setupAPIRoutes(app, fakeKeycloak as never);
      server = app.listen(0);
      await new Promise((resolve) => server.once('listening', resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    const call = (method: string, url: string, body?: unknown, user: string | null = 'a') =>
      fetch(`${origin}/api/v1${url}`, {
        method,
        headers: {
          ...(user ? { 'x-test-user': user } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it('requires authentication', async () => {
      expect((await call('GET', `/patients/${P1}/studies`, undefined, null)).status).toBe(401);
      expect((await call('GET', `/patients/${P1}/series/${SE_AX}`, undefined, null)).status).toBe(401);
    });

    it('isolates patients: a foreign series or study is the same 404 as an unknown one', async () => {
      const foreign = await call('GET', `/patients/${P1}/series/${SE_P2}`);
      const unknown = await call('GET', `/patients/${P1}/series/55555555-5555-4555-8555-999999999999`);
      expect([foreign.status, unknown.status]).toEqual([404, 404]);
      expect(await foreign.json()).toEqual(await unknown.json());
      expect((await call('GET', `/patients/${P2}/studies/${ST1}/series`)).status).toBe(404);
      expect((await call('POST', `/patients/${P1}/series/${SE_P2}/review/complete`, { presentedImageIds: [img(50)] })).status).toBe(404);
      // The file route still rejects another patient's image.
      expect((await call('GET', `/patients/${P2}/images/${img(1)}/file`)).status).toBe(404);
    });

    it('exposes no stored paths, file names, UIDs or hashes; /uploads is not served', async () => {
      const bodies = [
        await (await call('GET', `/patients/${P1}/studies`)).text(),
        await (await call('GET', `/patients/${P1}/studies/${ST1}/series`)).text(),
        ...(await Promise.all(
          [SE_AX, SE_MIX, SE_MF, SE_OTHER].map(async (id) => (await call('GET', `/patients/${P1}/series/${id}`)).text())
        )),
      ];
      for (const body of bodies) {
        expect(body).not.toMatch(/\/uploads|IM\d|"source"|"details"|cluster/i);
        expect(body).not.toContain('2.25.');
        expect(body).not.toContain(HASH);
      }
      expect((await fetch(`${origin}/uploads/${P1}/${SE_AX}/IM1`)).status).toBe(404);
    });

    it('Complete review over HTTP: 200 for a simple stack, 409 codes otherwise', async () => {
      const finish = (series: string, presentedImageIds: string[]) =>
        call('POST', `/patients/${P1}/series/${series}/review/complete`, { presentedImageIds });
      const mixed = await finish(SE_MIX, [img(10), img(11)]);
      expect(mixed.status).toBe(409);
      expect(await mixed.json()).toMatchObject({ code: 'SERIES_NOT_FULLY_REVIEWABLE' });
      const multiFrame = await finish(SE_MF, [img(20)]);
      expect(await multiFrame.json()).toMatchObject({ code: 'SERIES_NOT_FULLY_REVIEWABLE' });
      const changed = await finish(SE_AX, [img(1)]);
      expect(await changed.json()).toMatchObject({ code: 'SERIES_CHANGED' });
      expect((await call('POST', `/patients/${P1}/series/${SE_AX}/review/complete`, {})).status).toBe(400);

      const ok = await finish(SE_AX, AX_DISPLAYED);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ imageCount: 4, implicitNormal: 4, skippedBroken: 1 });
      const series = await (await call('GET', `/patients/${P1}/series/${SE_AX}`)).json();
      expect(series.series.review).toMatchObject({ normal: 4, notReviewed: 0, broken: 1 });
    });

    it('an empty JSON body is a prompt 400 (never waits on the request stream)', async () => {
      const admin = (method: string, url: string) =>
        fetch(`${origin}/api/v1${url}`, {
          method,
          headers: { 'x-test-user': 'admin', 'x-test-roles': 'dashboard:admin', 'content-type': 'application/json' },
          body: '{}',
        });
      expect((await call('POST', `/patients/${P1}/series/${SE_AX}/review/complete`, {})).status).toBe(400);
      expect((await admin('PUT', `/patients/images/${img(1)}/review/resolution`)).status).toBe(400);
      expect((await admin('POST', '/review/freeze')).status).toBe(400);
    });

    it('the removed cluster API is 410 Gone and writes nothing', async () => {
      const cluster = '22222222-2222-4222-8222-000000000001';
      for (const [method, url] of [
        ['GET', '/patients/slug/patient-one/clusters/cluster/0'],
        ['PATCH', `/patients/clusters/${cluster}`],
        ['DELETE', `/patients/clusters/${cluster}`],
        ['POST', `/patients/clusters/${cluster}/review/finish`],
      ]) {
        const response = await call(method, url);
        expect([method, response.status]).toEqual([method, 410]);
        expect(await response.json()).toMatchObject({ code: 'CLUSTERS_REMOVED' });
      }
      expect(await rows('SELECT 1 FROM patient_image_review_completions')).toHaveLength(0);
    });

    describe('LLM check-items ownership', () => {
      let checkItems: jest.SpyInstance;
      beforeEach(() => {
        const { llmService } = require('./llm.service');
        checkItems = jest
          .spyOn(llmService, 'checkItems')
          .mockResolvedValue({ items: [] });
      });
      afterEach(() => checkItems.mockRestore());
      const check = (body: unknown) => call('POST', '/llm/check-items', body);

      it('sends only images of the requested Series of the patient', async () => {
        const response = await check({ patientId: P1, seriesId: SE_AX, imageIds: [img(2), img(1)] });
        expect(response.status).toBe(200);
        expect(checkItems).toHaveBeenCalledWith([
          `/uploads/${P1}/${SE_AX}/IM2`,
          `/uploads/${P1}/${SE_AX}/IM1`,
        ]);
      });

      it.each([
        ['an image of another series of the patient', { patientId: P1, seriesId: SE_AX, imageIds: [img(1), img(30)] }],
        ["another patient's series", { patientId: P1, seriesId: SE_P2, imageIds: [img(50)] }],
        ["another patient's image", { patientId: P1, seriesId: SE_AX, imageIds: [img(50)] }],
        ['the series under the wrong patient', { patientId: P2, seriesId: SE_AX, imageIds: [img(1)] }],
        ['an unknown image', { patientId: P1, seriesId: SE_AX, imageIds: ['33333333-3333-4333-8333-999999999999'] }],
        ['a malformed id', { patientId: P1, seriesId: SE_AX, imageIds: ['../../etc/passwd'] }],
      ])('rejects %s with the same 404, sending nothing', async (_, body) => {
        const response = await check(body);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual(
          await (await check({ patientId: P1, seriesId: SE_AX, imageIds: ['33333333-3333-4333-8333-999999999998'] })).json()
        );
        expect(checkItems).not.toHaveBeenCalled();
      });

      it('rejects a trashed patient and a body without the Series context', async () => {
        expect((await check([img(1)])).status).toBe(400);
        expect((await check({ imageIds: [img(1)] })).status).toBe(400);
        await sequelize.query(`UPDATE patients SET "deletedAt" = now() WHERE id = $1`, { bind: [P1] });
        expect((await check({ patientId: P1, seriesId: SE_AX, imageIds: [img(1)] })).status).toBe(404);
        expect(checkItems).not.toHaveBeenCalled();
      });
    });

    it('moves or renames no stored file', async () => {
      const uploads = path.join(tmp, 'uploads');
      const list = () => readdir(uploads, { recursive: true }).catch(() => []);
      const before = await list();
      await call('GET', `/patients/${P1}/studies`);
      await call('GET', `/patients/${P1}/series/${SE_AX}`);
      await call('POST', `/patients/${P1}/series/${SE_AX}/review/complete`, { presentedImageIds: AX_DISPLAYED });
      expect(await list()).toEqual(before);
    });
  });
});
