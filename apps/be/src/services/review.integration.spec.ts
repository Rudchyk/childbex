/**
 * Review semantics against PostgreSQL: effective state, vote history,
 * resolutions, per-reviewer Series "Complete review" (implicit NORMAL),
 * bulk votes, multi-reviewer conflicts, the review freeze and lock
 * (including races with mutations in flight) and the HTTP API with a fake
 * Keycloak.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_review" (created when missing); every test
 * recreates its `public` schema.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { QueryTypes, Sequelize } from 'sequelize';
import {
  PatientImageReviewVoteTypes as Vote,
  ReviewResolutionLabel,
} from '@libs/schemas';
import type * as MigratorModule from '../db/migrator';
import type * as ReviewModule from './review.service';
import type * as ApiModule from '../api/v1/api';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
};
jest.mock('./logger.service', () => ({ logger: mockLogger }));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL review tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const PATIENT = '11111111-1111-4111-8111-111111111111';
const OTHER_PATIENT = '11111111-1111-4111-8111-111111111112';
const STUDY = '44444444-4444-4444-8444-444444444441';
const OTHER_STUDY = '44444444-4444-4444-8444-444444444442';
const SERIES = '22222222-2222-4222-8222-222222222222';
const OTHER_SERIES = '22222222-2222-4222-8222-222222222223';
/** A series of another patient. */
const FOREIGN_SERIES = '22222222-2222-4222-8222-222222222224';
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const reviewer = (name: string) => ({ id: `sub-${name}`, name: `Reviewer ${name}` });
const ADMIN = { id: 'sub-admin', name: 'Admin' };

/** Settles within `ms`? (to show that a call is blocked on a lock). */
const settlesWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.then(
      () => true,
      () => true
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);

const gate = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};

describeWithDatabase('review semantics (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let review: typeof ReviewModule;
  let tmp: string;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_review`;
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

    tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-review-'));
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
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrator.migrateUp(sequelize);
    for (const [patient, slug] of [[PATIENT, 'synthetic'], [OTHER_PATIENT, 'other']]) {
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ($1, 'Synthetic', $2, 'u', 'U', now(), now())`,
        { bind: [patient, slug] }
      );
    }
    for (const [study, patient] of [[STUDY, PATIENT], [OTHER_STUDY, OTHER_PATIENT]]) {
      await sequelize.query(
        `INSERT INTO studies (id, "patientId", "studyInstanceUid", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, now(), now())`,
        { bind: [study, patient, `2.25.4${study.slice(-1)}`] }
      );
    }
    for (const [series, study] of [[SERIES, STUDY], [OTHER_SERIES, STUDY], [FOREIGN_SERIES, OTHER_STUDY]]) {
      await sequelize.query(
        `INSERT INTO series (id, "studyId", "seriesInstanceUid", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, now(), now())`,
        { bind: [series, study, `2.25.2${series.slice(-1)}`] }
      );
    }
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Helpers -----------------------------------------------------------------

  /** An axial slice (complete geometry) of a series, or a broken image. */
  const addImage = async (
    n: number,
    { series = SERIES, broken = false } = {}
  ) => {
    await sequelize.query(
      `INSERT INTO patients_images (id, source, "seriesId", "isBrocken", status,
         "imageOrientationPatient", "imagePositionPatient", rows, columns, "pixelSpacing",
         "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, '{1,0,0,0,1,0}', $6, 4, 4, '{0.5,0.5}', now(), now())`,
      {
        bind: [
          id(n),
          `/uploads/p/s/IM${n}`,
          series,
          broken,
          broken ? 'broken' : 'not_reviewed',
          `{0,0,${n}}`,
        ],
      }
    );
    return id(n);
  };
  /** The non-broken images of a series (what the viewer presents). */
  const presentedOf = async (series: string) =>
    (
      await rows(
        `SELECT id FROM patients_images WHERE "seriesId" = $1 AND NOT "isBrocken"`,
        [series]
      )
    ).map(({ id: imageId }) => imageId as string);
  const completeSeries = async (series = SERIES, who = 'f') =>
    review.completeSeriesReview(PATIENT, series, reviewer(who), await presentedOf(series));

  const stateOf = async (imageId: string) =>
    (
      await sequelize.query<Record<string, unknown>>(
        `SELECT "reviewState", "reviewStateSource", status::text AS status,
                "isAbnormal", "votesCount", "normalVotes", "abnormalVotes",
                "uncertainVotes", "adminResolutionId", "adminResolutionName",
                "resolutionComment", "resolvedAt"
         FROM patients_images WHERE id = $1`,
        { bind: [imageId], type: QueryTypes.SELECT }
      )
    )[0];

  const rows = (sql: string, bind: unknown[] = []) =>
    sequelize.query<Record<string, unknown>>(sql, { bind, type: QueryTypes.SELECT });

  const vote = (imageId: string, who: string, value: Vote, comment: string | null = null) =>
    review.castVote(imageId, reviewer(who), { vote: value, comment });

  // --- Effective state -----------------------------------------------------------

  describe('effective state', () => {
    it('zero votes -> NOT_REVIEWED (never NORMAL by default)', async () => {
      const image = await addImage(1);
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'NOT_REVIEWED',
        reviewStateSource: 'NONE',
        status: 'not_reviewed',
        isAbnormal: false,
        votesCount: 0,
      });
    });

    it('uncertain-only -> UNCERTAIN (not CONFLICTED)', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.UNCERTAIN);
      await vote(image, 'b', Vote.UNCERTAIN);
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'UNCERTAIN',
        reviewStateSource: 'VOTES',
        status: 'uncertain',
        isAbnormal: false,
        votesCount: 2,
        uncertainVotes: 2,
      });
    });

    it('disagreement -> CONFLICTED regardless of the majority', async () => {
      const image = await addImage(1);
      for (const who of ['a', 'b', 'c', 'd']) await vote(image, who, Vote.NORMAL);
      await vote(image, 'e', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'CONFLICTED',
        reviewStateSource: 'VOTES',
        status: 'conflicted',
        isAbnormal: false,
        votesCount: 5,
        normalVotes: 4,
        abnormalVotes: 1,
      });
    });

    it('unanimous ABNORMAL -> ABNORMAL, the only state with isAbnormal', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.ABNORMAL);
      await vote(image, 'b', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'ABNORMAL',
        status: 'abnormal',
        isAbnormal: true,
      });
    });
  });

  // --- Votes ---------------------------------------------------------------------

  describe('votes', () => {
    it('POST is create-or-change: one vote per reviewer, every change in the history', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.NORMAL, 'fine');
      await vote(image, 'a', Vote.ABNORMAL, 'lesion?');
      await vote(image, 'a', Vote.ABNORMAL, 'lesion?'); // no change, no event

      expect(await rows('SELECT vote::text AS vote, comment FROM patient_image_review_votes')).toEqual([
        { vote: 'abnormal', comment: 'lesion?' },
      ]);
      expect(
        await rows(
          `SELECT action, "previousVote", "newVote", "previousComment", "newComment", "reviewerId"
           FROM patient_image_review_vote_events ORDER BY "createdAt"`
        )
      ).toEqual([
        { action: 'cast', previousVote: null, newVote: 'normal', previousComment: null, newComment: 'fine', reviewerId: 'sub-a' },
        { action: 'changed', previousVote: 'normal', newVote: 'abnormal', previousComment: 'fine', newComment: 'lesion?', reviewerId: 'sub-a' },
      ]);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL', votesCount: 1 });
    });

    it('concurrent POSTs of one reviewer never fail on the unique index', async () => {
      const image = await addImage(1);
      const results = await Promise.allSettled(
        [Vote.NORMAL, Vote.ABNORMAL, Vote.NORMAL, Vote.UNCERTAIN, Vote.NORMAL].map((value) =>
          vote(image, 'a', value)
        )
      );
      expect(results.map(({ status }) => status)).toEqual(Array(5).fill('fulfilled'));
      const votes = await rows('SELECT vote::text AS vote FROM patient_image_review_votes');
      expect(votes).toHaveLength(1);
      expect(await stateOf(image)).toMatchObject({ votesCount: 1 });
    });

    it('concurrent votes of many reviewers: no lost counter updates', async () => {
      const image = await addImage(1);
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => vote(image, `r${i}`, i < 7 ? Vote.NORMAL : Vote.ABNORMAL))
      );
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'CONFLICTED',
        votesCount: 10,
        normalVotes: 7,
        abnormalVotes: 3,
      });
    });

    it("PATCH cannot modify another reviewer's vote (or a vote of another image)", async () => {
      const image = await addImage(1);
      const other = await addImage(2);
      const theirs = await vote(image, 'a', Vote.NORMAL, 'mine');

      await expect(
        review.changeOwnVote(image, theirs.id, reviewer('b'), { vote: Vote.ABNORMAL, comment: null })
      ).rejects.toMatchObject({ code: 'VOTE_NOT_FOUND', status: 404 });
      await expect(
        review.changeOwnVote(other, theirs.id, reviewer('a'), { vote: Vote.ABNORMAL, comment: null })
      ).rejects.toMatchObject({ code: 'VOTE_NOT_FOUND', status: 404 });

      expect(await rows('SELECT vote::text AS vote, comment FROM patient_image_review_votes')).toEqual([
        { vote: 'normal', comment: 'mine' },
      ]);
      expect(await rows('SELECT action FROM patient_image_review_vote_events')).toEqual([{ action: 'cast' }]);

      // The owner can change it.
      await review.changeOwnVote(image, theirs.id, reviewer('a'), { vote: Vote.ABNORMAL, comment: 'mine' });
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL' });
    });
  });

  // --- Resolutions -----------------------------------------------------------------

  describe('resolutions', () => {
    it('take precedence over votes, keep history, and removal lets the votes decide again', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.NORMAL);
      await vote(image, 'b', Vote.ABNORMAL);

      await review.setResolution(image, ADMIN, { label: ReviewResolutionLabel.ABNORMAL, comment: 'checked' });
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'ABNORMAL',
        reviewStateSource: 'RESOLUTION',
        status: 'admin_resolved',
        isAbnormal: true,
        adminResolutionId: 'sub-admin',
        adminResolutionName: 'Admin',
        resolutionComment: 'checked',
      });

      await review.setResolution(image, ADMIN, { label: ReviewResolutionLabel.UNCERTAIN });
      const history = await rows(
        `SELECT label, origin, "supersededAt" IS NOT NULL AS superseded, "supersededById"
         FROM patient_image_review_resolutions ORDER BY "createdAt"`
      );
      expect(history).toEqual([
        { label: 'ABNORMAL', origin: 'admin', superseded: true, supersededById: 'sub-admin' },
        { label: 'UNCERTAIN', origin: 'admin', superseded: false, supersededById: null },
      ]);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'UNCERTAIN', isAbnormal: false });

      await review.removeResolution(image, ADMIN);
      expect(await stateOf(image)).toMatchObject({
        reviewState: 'CONFLICTED',
        reviewStateSource: 'VOTES',
        status: 'conflicted',
        adminResolutionId: null,
        adminResolutionName: null,
        resolutionComment: null,
        resolvedAt: null,
      });
      expect(await rows('SELECT 1 FROM patient_image_review_resolutions')).toHaveLength(2);
      await expect(review.removeResolution(image, ADMIN)).rejects.toMatchObject({
        code: 'NO_ACTIVE_RESOLUTION',
      });
    });
  });

  describe('database constraints', () => {
    const insertResolution = (imageId: string, values: string) =>
      sequelize.query(
        `INSERT INTO patient_image_review_resolutions
           (id, "patientImageId", label, origin, "resolverId", "resolverName", "confirmedByName", "supersededAt", "createdAt")
         VALUES (gen_random_uuid(), '${imageId}', ${values}, now())`
      );

    it('at most one active resolution and one active freeze', async () => {
      const image = await addImage(1);
      await insertResolution(image, `'NORMAL', 'admin', 'a', 'A', NULL, NULL`);
      await expect(
        insertResolution(image, `'ABNORMAL', 'admin', 'a', 'A', NULL, NULL`)
      ).rejects.toMatchObject({
        parent: { code: '23505', constraint: 'patient_image_review_resolutions_one_active' },
      });
      await review.freezeReview(ADMIN, 'one');
      await expect(
        sequelize.query(
          `INSERT INTO review_freezes (id, reason, "frozenById", "frozenByName", "frozenAt")
           VALUES (gen_random_uuid(), 'two', 'a', 'A', now())`
        )
      ).rejects.toMatchObject({ parent: { code: '23505', constraint: 'review_freezes_one_active' } });
    });

    it.each([
      ['an unknown label', `'MAYBE', 'admin', 'a', 'A', NULL, NULL`, 'patient_image_review_resolutions_label'],
      ['an admin resolution without a label', `NULL, 'admin', 'a', 'A', NULL, NULL`, 'patient_image_review_resolutions_labelled'],
      ['an admin resolution without a resolver', `'NORMAL', 'admin', NULL, NULL, NULL, NULL`, 'patient_image_review_resolutions_admin_resolver'],
      ['an active set-aside legacy resolution', `NULL, 'legacy_unlabeled', NULL, NULL, 'Op', NULL`, 'patient_image_review_resolutions_unlabeled_inactive'],
      ['a legacy resolution without the operator', `'NORMAL', 'legacy_confirmed', NULL, NULL, NULL, NULL`, 'patient_image_review_resolutions_confirmed'],
    ])('rejects %s', async (_, values, constraint) => {
      const image = await addImage(1);
      await expect(insertResolution(image, values)).rejects.toMatchObject({
        parent: { code: '23514', constraint },
      });
    });
  });

  // --- Complete review (per reviewer, implicit NORMAL) ------------------------------

  describe('complete review', () => {
    it('gives the reviewer an implicit NORMAL on every unvoted image, without vote rows', async () => {
      const untouched = await addImage(1);
      const ownAbnormal = await addImage(2);
      const ownUncertain = await addImage(3);
      const broken = await addImage(4, { broken: true });
      const elsewhere = await addImage(5, { series: OTHER_SERIES });
      await vote(ownAbnormal, 'f', Vote.ABNORMAL);
      await vote(ownUncertain, 'f', Vote.UNCERTAIN);

      const result = await completeSeries();

      expect(result).toEqual({
        completionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        completedAt: expect.any(String),
        imageSetRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
        imageCount: 3,
        explicitAbnormal: 1,
        explicitUncertain: 1,
        explicitNormal: 0,
        implicitNormal: 1,
        skippedBroken: 1,
      });
      expect(
        await rows(
          `SELECT "seriesId", "reviewerId", "reviewerName", "imageIds", "imageCount", "imageSetHash",
                  "completedAt" IS NOT NULL AS "hasCompletedAt"
           FROM series_review_completions`
        )
      ).toEqual([
        {
          seriesId: SERIES,
          reviewerId: 'sub-f',
          reviewerName: 'Reviewer f',
          imageIds: [untouched, ownAbnormal, ownUncertain].sort(),
          imageCount: 3,
          imageSetHash: result.imageSetRevision,
          hasCompletedAt: true,
        },
      ]);
      // No redundant explicit NORMAL rows, no per-image completion rows.
      expect(await rows('SELECT 1 FROM patient_image_review_votes')).toHaveLength(2);
      expect(await rows('SELECT 1 FROM patient_image_review_vote_events')).toHaveLength(2);
      expect(await rows('SELECT 1 FROM patient_image_review_completions')).toHaveLength(0);

      expect(await stateOf(untouched)).toMatchObject({
        reviewState: 'NORMAL',
        reviewStateSource: 'FINISH_REVIEW',
        status: 'normal',
        isAbnormal: false,
        votesCount: 0,
        normalVotes: 0,
      });
      expect(await stateOf(ownAbnormal)).toMatchObject({ reviewState: 'ABNORMAL', reviewStateSource: 'VOTES' });
      expect(await stateOf(ownUncertain)).toMatchObject({ reviewState: 'UNCERTAIN', reviewStateSource: 'VOTES' });
      expect(await stateOf(broken)).toMatchObject({ reviewState: 'NOT_REVIEWED', status: 'broken' });
      expect(await stateOf(elsewhere)).toMatchObject({ reviewState: 'NOT_REVIEWED' });
    });

    it('does not lock the review: the reviewer changes any decision later, without reopening', async () => {
      const image = await addImage(1);
      const other = await addImage(2);
      await vote(other, 'f', Vote.ABNORMAL);
      await completeSeries();
      expect(await stateOf(image)).toMatchObject({ reviewState: 'NORMAL', reviewStateSource: 'FINISH_REVIEW' });

      // implicit Normal -> Abnormal -> Not sure -> Normal (explicit) -> Abnormal
      for (const [value, expected] of [
        [Vote.ABNORMAL, 'ABNORMAL'],
        [Vote.UNCERTAIN, 'UNCERTAIN'],
        [Vote.NORMAL, 'NORMAL'],
        [Vote.ABNORMAL, 'ABNORMAL'],
      ] as const) {
        await vote(image, 'f', value);
        expect(await stateOf(image)).toMatchObject({ reviewState: expected, reviewStateSource: 'VOTES', votesCount: 1 });
      }
      // Abnormal -> Normal and Not sure -> Normal on the other image.
      await vote(other, 'f', Vote.NORMAL);
      expect(await stateOf(other)).toMatchObject({ reviewState: 'NORMAL', reviewStateSource: 'VOTES' });
      await vote(other, 'f', Vote.UNCERTAIN);
      await vote(other, 'f', Vote.NORMAL);
      expect(await stateOf(other)).toMatchObject({ reviewState: 'NORMAL', normalVotes: 1 });
      // The completion record is unchanged history.
      expect(await rows('SELECT 1 FROM series_review_completions')).toHaveLength(1);
    });

    it('distinguishes the completed image set from a changed one; completing again covers it', async () => {
      const first = await addImage(1);
      const firstResult = await completeSeries();
      const added = await addImage(2); // imported after the completion

      expect(await stateOf(first)).toMatchObject({ reviewState: 'NORMAL' });
      // Not reviewed by f: never implicitly NORMAL.
      expect(await stateOf(added)).toMatchObject({ reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE' });
      const { getPatientSeries } = require('./hierarchy.service');
      const series = await getPatientSeries(PATIENT, SERIES);
      expect(series.review.imageSetRevision).not.toBe(firstResult.imageSetRevision);
      expect(series.review.completions).toEqual([
        expect.objectContaining({
          reviewerId: 'sub-f',
          imageSetRevision: firstResult.imageSetRevision,
          imageCount: 1,
          current: false,
          uncoveredImageCount: 1,
        }),
      ]);
      // A stale presented set is refused.
      await expect(
        review.completeSeriesReview(PATIENT, SERIES, reviewer('f'), [first])
      ).rejects.toMatchObject({ code: 'SERIES_CHANGED', status: 409 });

      const second = await completeSeries();
      expect(second.imageSetRevision).toBe(
        (await getPatientSeries(PATIENT, SERIES)).review.imageSetRevision
      );
      expect(await stateOf(added)).toMatchObject({ reviewState: 'NORMAL', reviewStateSource: 'FINISH_REVIEW' });
      // Append-only history: both completions are kept, the latest counts.
      expect(await rows('SELECT 1 FROM series_review_completions')).toHaveLength(2);
      expect((await getPatientSeries(PATIENT, SERIES)).review.completions).toEqual([
        expect.objectContaining({ current: true, uncoveredImageCount: 0, imageCount: 2 }),
      ]);
    });

    it('rejects an unknown series and a series of another patient alike', async () => {
      for (const series of ['99999999-9999-4999-8999-999999999999', FOREIGN_SERIES]) {
        await expect(
          review.completeSeriesReview(PATIENT, series, reviewer('f'), [])
        ).rejects.toMatchObject({ code: 'SERIES_NOT_FOUND', status: 404 });
      }
    });

    it('legacy per-image completions keep their meaning (lowest precedence)', async () => {
      const image = await addImage(1);
      await sequelize.query(
        `INSERT INTO patient_image_review_completions (id, "patientImageId", "runId", "scopeSeriesId",
           "completedById", "completedByName", "createdAt")
         VALUES (gen_random_uuid(), $1, gen_random_uuid(), $2, 'sub-old', 'Old', now())`,
        { bind: [image, SERIES] }
      );
      await sequelize.transaction((transaction) =>
        review.recomputeReviewCaches([image], transaction)
      );
      expect(await stateOf(image)).toMatchObject({ reviewState: 'NORMAL', reviewStateSource: 'FINISH_REVIEW' });
      // Any vote takes precedence over a legacy completion (as before).
      await vote(image, 'b', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL', reviewStateSource: 'VOTES' });
    });
  });

  // --- Multiple reviewers -----------------------------------------------------------

  describe('multiple reviewers', () => {
    it('explicit NORMAL of one doctor against ABNORMAL of another: both kept, CONFLICTED', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.ABNORMAL, 'lesion?');
      await vote(image, 'b', Vote.NORMAL);
      expect(await rows(`SELECT "reviewerId", vote::text AS vote, comment FROM patient_image_review_votes ORDER BY "reviewerId"`)).toEqual([
        { reviewerId: 'sub-a', vote: 'abnormal', comment: 'lesion?' },
        { reviewerId: 'sub-b', vote: 'normal', comment: null },
      ]);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'CONFLICTED', isAbnormal: false, normalVotes: 1, abnormalVotes: 1 });
    });

    it('NOT SURE of one doctor and ABNORMAL / NORMAL of others stay separate opinions', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.UNCERTAIN);
      await vote(image, 'b', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'CONFLICTED', uncertainVotes: 1, abnormalVotes: 1 });
      await vote(image, 'b', Vote.NORMAL);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'CONFLICTED', uncertainVotes: 1, normalVotes: 1 });
    });

    it("one doctor's completed implicit NORMAL against another's explicit ABNORMAL: CONFLICTED", async () => {
      const image = await addImage(1);
      const quiet = await addImage(2);
      await completeSeries(SERIES, 'a');
      await vote(image, 'b', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'CONFLICTED', reviewStateSource: 'VOTES', isAbnormal: false });
      // B completes too: B's explicit vote stays; the other image is NORMAL for both.
      await completeSeries(SERIES, 'b');
      expect(await stateOf(image)).toMatchObject({ reviewState: 'CONFLICTED' });
      expect(await stateOf(quiet)).toMatchObject({ reviewState: 'NORMAL', reviewStateSource: 'FINISH_REVIEW' });
      // A agrees later with an explicit vote: unanimous ABNORMAL.
      await vote(image, 'a', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL', isAbnormal: true, abnormalVotes: 2 });
      const { getPatientSeries } = require('./hierarchy.service');
      const series = await getPatientSeries(PATIENT, SERIES);
      expect(series.images.find(({ id }: { id: string }) => id === quiet).implicitNormals.map(
        ({ reviewerId }: { reviewerId: string }) => reviewerId
      )).toEqual(['sub-a', 'sub-b']);
      expect(series.images.find(({ id }: { id: string }) => id === image).implicitNormals).toEqual([]);
    });
  });

  // --- Bulk votes ------------------------------------------------------------------------

  describe('bulk votes', () => {
    const bulk = (ids: string[], value: Vote, who = 'a', series = SERIES, patient = PATIENT) =>
      review.castBulkVote(patient, series, reviewer(who), ids, value);

    it.each([
      [Vote.NORMAL, 'NORMAL'],
      [Vote.ABNORMAL, 'ABNORMAL'],
      [Vote.UNCERTAIN, 'UNCERTAIN'],
    ])('sets %s on every selected image with history, only for the reviewer', async (value, expected) => {
      const ids = [await addImage(1), await addImage(2), await addImage(3)];
      const result = await bulk(ids.slice(0, 2), value);
      expect(result).toEqual({ requested: 2, created: 2, changed: 0, unchanged: 0 });
      for (const id of ids.slice(0, 2)) {
        expect(await stateOf(id)).toMatchObject({ reviewState: expected, reviewStateSource: 'VOTES', votesCount: 1 });
      }
      expect(await stateOf(ids[2])).toMatchObject({ reviewState: 'NOT_REVIEWED' });
      expect(await rows(`SELECT action, "newVote" FROM patient_image_review_vote_events`)).toEqual([
        { action: 'cast', newVote: value },
        { action: 'cast', newVote: value },
      ]);
    });

    it('is idempotent and changes existing own votes, keeping their comments', async () => {
      const [one, two] = [await addImage(1), await addImage(2)];
      await vote(one, 'a', Vote.ABNORMAL, 'nodule');
      expect(await bulk([one, two], Vote.NORMAL)).toEqual({ requested: 2, created: 1, changed: 1, unchanged: 0 });
      expect(await bulk([one, two, one], Vote.NORMAL)).toEqual({ requested: 2, created: 0, changed: 0, unchanged: 2 });
      expect(await rows(`SELECT vote::text AS vote, comment FROM patient_image_review_votes ORDER BY "patientImageId"`)).toEqual([
        { vote: 'normal', comment: 'nodule' },
        { vote: 'normal', comment: null },
      ]);
      expect(
        await rows(`SELECT action, "previousVote", "newVote", "previousComment", "newComment" FROM patient_image_review_vote_events WHERE "patientImageId" = $1 ORDER BY "createdAt", action`, [one])
      ).toEqual([
        { action: 'cast', previousVote: null, newVote: 'abnormal', previousComment: null, newComment: 'nodule' },
        { action: 'changed', previousVote: 'abnormal', newVote: 'normal', previousComment: 'nodule', newComment: 'nodule' },
      ]);
    });

    it("never touches another reviewer's votes", async () => {
      const [one, two] = [await addImage(1), await addImage(2)];
      await vote(one, 'b', Vote.ABNORMAL, 'theirs');
      await bulk([one, two], Vote.NORMAL, 'a');
      expect(await rows(`SELECT "reviewerId", vote::text AS vote, comment FROM patient_image_review_votes WHERE "patientImageId" = $1 ORDER BY "reviewerId"`, [one])).toEqual([
        { reviewerId: 'sub-a', vote: 'normal', comment: null },
        { reviewerId: 'sub-b', vote: 'abnormal', comment: 'theirs' },
      ]);
      expect(await stateOf(one)).toMatchObject({ reviewState: 'CONFLICTED' });
    });

    it('is atomic: one image of another series, another patient, broken or unknown refuses all', async () => {
      const mine = [await addImage(1), await addImage(2)];
      const otherSeries = await addImage(3, { series: OTHER_SERIES });
      const foreign = await addImage(4, { series: FOREIGN_SERIES });
      const broken = await addImage(5, { broken: true });
      for (const [ids, code, status] of [
        [[...mine, otherSeries], 'IMAGES_NOT_IN_SERIES', 400],
        [[...mine, foreign], 'IMAGES_NOT_IN_SERIES', 400],
        [[...mine, '99999999-9999-4999-8999-999999999999'], 'IMAGES_NOT_IN_SERIES', 400],
        [[...mine, broken], 'IMAGES_NOT_REVIEWABLE', 400],
        [[...mine, 'not-a-uuid'], 'INVALID_IMAGE_IDS', 400],
        [[], 'INVALID_IMAGE_IDS', 400],
      ] as const) {
        await expect(bulk([...ids], Vote.ABNORMAL)).rejects.toMatchObject({ code, status });
      }
      // A series of another patient through this patient: not found.
      await expect(bulk([foreign], Vote.ABNORMAL, 'a', FOREIGN_SERIES)).rejects.toMatchObject({
        code: 'SERIES_NOT_FOUND',
        status: 404,
      });
      expect(await rows('SELECT 1 FROM patient_image_review_votes')).toHaveLength(0);
      expect(await rows('SELECT 1 FROM patient_image_review_vote_events')).toHaveLength(0);
      for (const id of mine) expect(await stateOf(id)).toMatchObject({ reviewState: 'NOT_REVIEWED' });
    });

    it('rolls back everything when the transaction fails midway', async () => {
      const ids = [await addImage(1), await addImage(2)];
      const { PatientImageReviewVoteEvent } = require('../db/models/PatientImageReviewVoteEvent.model');
      const spy = jest.spyOn(PatientImageReviewVoteEvent, 'bulkCreate').mockRejectedValueOnce(new Error('boom'));
      await expect(bulk(ids, Vote.ABNORMAL)).rejects.toThrow('boom');
      spy.mockRestore();
      expect(await rows('SELECT 1 FROM patient_image_review_votes')).toHaveLength(0);
      for (const id of ids) expect(await stateOf(id)).toMatchObject({ reviewState: 'NOT_REVIEWED' });
    });

    it('handles a large Series in one request', async () => {
      const ids: string[] = [];
      for (let n = 1; n <= 400; n++) ids.push(await addImage(n));
      expect(await bulk(ids, Vote.ABNORMAL)).toMatchObject({ requested: 400, created: 400 });
      expect(await rows(`SELECT count(*)::int AS n FROM patients_images WHERE "reviewState" = 'ABNORMAL'`)).toEqual([{ n: 400 }]);
    });
  });

  // --- Freeze ------------------------------------------------------------------------

  describe('review freeze', () => {
    it('refuses every review mutation while frozen, without changes', async () => {
      const image = await addImage(1);
      await vote(image, 'a', Vote.NORMAL);
      const before = await stateOf(image);

      expect(await review.freezeReview(ADMIN, 'dataset export')).toMatchObject({
        frozen: true,
        reason: 'dataset export',
        frozenByName: 'Admin',
      });
      const frozen = { code: 'REVIEW_FROZEN', status: 409 };
      await expect(vote(image, 'a', Vote.ABNORMAL)).rejects.toMatchObject(frozen);
      await expect(vote(image, 'b', Vote.ABNORMAL)).rejects.toMatchObject(frozen);
      await expect(
        review.setResolution(image, ADMIN, { label: ReviewResolutionLabel.ABNORMAL })
      ).rejects.toMatchObject(frozen);
      await expect(review.removeResolution(image, ADMIN)).rejects.toMatchObject(frozen);
      await expect(completeSeries()).rejects.toMatchObject(frozen);
      await expect(review.freezeReview(ADMIN, 'again')).rejects.toMatchObject({
        code: 'REVIEW_ALREADY_FROZEN',
      });

      expect(await stateOf(image)).toEqual(before);
      expect(await rows('SELECT 1 FROM patient_image_review_vote_events')).toHaveLength(1);

      expect(await review.unfreezeReview(ADMIN)).toMatchObject({ frozen: false });
      await vote(image, 'b', Vote.ABNORMAL);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'CONFLICTED' });
      await expect(review.unfreezeReview(ADMIN)).rejects.toMatchObject({ code: 'REVIEW_NOT_FROZEN' });
      // The freeze is kept as history.
      expect(
        await rows(`SELECT "unfrozenById", "unfrozenAt" IS NOT NULL AS unfrozen FROM review_freezes`)
      ).toEqual([{ unfrozenById: 'sub-admin', unfrozen: true }]);
    });

    it('race: a freeze waits for a mutation in flight, and later mutations are refused', async () => {
      const image = await addImage(1);
      const release = gate();
      const locked = gate();
      // A review mutation in flight (holds the shared lock until it commits).
      const inFlight = sequelize.transaction(async (transaction) => {
        await review.acquireReviewMutationLock(transaction);
        await sequelize.query(
          `INSERT INTO patient_image_review_votes (id, "patientImageId", "reviewerId", "reviewerName", vote, "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, 'sub-x', 'X', 'abnormal', now(), now())`,
          { bind: [image], transaction }
        );
        await review.recomputeReviewCaches([image], transaction);
        locked.open();
        await release.opened;
      });
      await locked.opened;

      const freezing = review.freezeReview(ADMIN, 'export');
      expect(await settlesWithin(freezing, 500)).toBe(false); // blocked by the mutation

      release.open();
      await inFlight;
      await expect(freezing).resolves.toMatchObject({ frozen: true });
      // The mutation committed before the freeze: it is in the frozen data.
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL', votesCount: 1 });
      await expect(vote(image, 'y', Vote.NORMAL)).rejects.toMatchObject({ code: 'REVIEW_FROZEN' });
      expect(await stateOf(image)).toMatchObject({ votesCount: 1 });
    });

    it('race: a mutation during a freeze in flight is refused at once (REVIEW_LOCKED), never queued', async () => {
      const image = await addImage(1);
      const release = gate();
      const locked = gate();
      // A freeze in flight (exclusive lock taken, row not committed yet).
      const freezing = sequelize.transaction(async (transaction) => {
        await sequelize.query('SELECT pg_advisory_xact_lock($1)', {
          bind: [review.REVIEW_FREEZE_LOCK_KEY],
          transaction,
        });
        await sequelize.query(
          `INSERT INTO review_freezes (id, reason, "frozenById", "frozenByName", "frozenAt")
           VALUES (gen_random_uuid(), 'export', 'sub-admin', 'Admin', now())`,
          { transaction }
        );
        locked.open();
        await release.opened;
      });
      await locked.opened;

      const voting = vote(image, 'a', Vote.ABNORMAL);
      expect(await settlesWithin(voting, 2000)).toBe(true); // does not wait
      await expect(voting).rejects.toMatchObject({ code: 'REVIEW_LOCKED', status: 409 });

      release.open();
      await freezing;
      await expect(vote(image, 'a', Vote.ABNORMAL)).rejects.toMatchObject({ code: 'REVIEW_FROZEN' });
      expect(await stateOf(image)).toMatchObject({ reviewState: 'NOT_REVIEWED', votesCount: 0 });
      expect(await rows('SELECT 1 FROM patient_image_review_votes')).toHaveLength(0);
    });
  });

  // --- HTTP API ------------------------------------------------------------------------

  describe('HTTP API', () => {
    let server: Server;
    let baseUrl: string;

    /** Keycloak stand-in: user from `x-test-user`, roles from `x-test-roles`. */
    const fakeKeycloak = {
      protect:
        (...roles: string[]) =>
        (req: express.Request, res: express.Response, next: express.NextFunction) => {
          const user = req.header('x-test-user');
          if (!user) return void res.status(401).end();
          const granted = (req.header('x-test-roles') ?? '').split(',');
          if (roles.length && !roles.some((role) => granted.includes(role))) {
            return void res.status(403).end();
          }
          (req as unknown as { kauth: unknown }).kauth = {
            grant: { access_token: { content: { sub: `sub-${user}`, name: `User ${user}` } } },
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
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    });

    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    const call = (
      method: string,
      url: string,
      { user = 'a', roles = '', body }: { user?: string; roles?: string; body?: unknown } = {}
    ) =>
      fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          'x-test-user': user,
          'x-test-roles': roles,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it('POST twice is create-or-change (204, never 500)', async () => {
      const image = await addImage(1);
      const first = await call('POST', `/patients/images/${image}/review-votes`, {
        body: { vote: 'normal', comment: null },
      });
      const second = await call('POST', `/patients/images/${image}/review-votes`, {
        body: { vote: 'abnormal', comment: null },
      });
      expect([first.status, second.status]).toEqual([204, 204]);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL', votesCount: 1 });
    });

    it("PATCH of another reviewer's vote is 404 and changes nothing", async () => {
      const image = await addImage(1);
      const theirs = await vote(image, 'a', Vote.NORMAL);

      const response = await call('PATCH', `/patients/images/${image}/review-votes/${theirs.id}`, {
        user: 'b',
        body: { vote: 'abnormal', comment: 'overwrite' },
      });
      expect(response.status).toBe(404);
      expect(await rows('SELECT vote::text AS vote, comment, "reviewerId" FROM patient_image_review_votes')).toEqual([
        { vote: 'normal', comment: null, reviewerId: 'sub-a' },
      ]);
      expect(
        (await call('PATCH', `/patients/images/${image}/review-votes/not-a-uuid`, {
          body: { vote: 'abnormal', comment: null },
        })).status
      ).toBe(404);
      expect(
        (await call('PATCH', `/patients/images/${image}/review-votes/${theirs.id}`, {
          user: 'a',
          body: { vote: 'abnormal', comment: null },
        })).status
      ).toBe(204);
    });

    it('resolution routes require the admin role; the series exposes the review state', async () => {
      const image = await addImage(1);
      const path = `/patients/images/${image}/review/resolution`;
      expect((await call('PUT', path, { body: { label: 'ABNORMAL' } })).status).toBe(403);
      expect(
        (await call('PUT', path, { roles: 'dashboard:admin', body: { label: 'MAYBE' } })).status
      ).toBe(400);
      expect(
        (await call('PUT', path, { roles: 'dashboard:admin', body: { label: 'ABNORMAL', comment: 'ok' } })).status
      ).toBe(204);

      const series = await (await call('GET', `/patients/${PATIENT}/series/${SERIES}`)).json();
      expect(series.images).toEqual([
        expect.objectContaining({
          id: image,
          reviewState: 'ABNORMAL',
          reviewStateSource: 'RESOLUTION',
          status: 'admin_resolved',
        }),
      ]);

      expect((await call('DELETE', path, { roles: 'dashboard:admin' })).status).toBe(204);
      expect((await call('DELETE', path, { roles: 'dashboard:admin' })).status).toBe(404);
    });

    describe('destructive operations under the review freeze', () => {
      const uploadRoot = () => process.env.UPLOAD_ROOT as string;
      const seriesFile = (patient = PATIENT, series = SERIES) =>
        path.join(uploadRoot(), patient, series, 'IM1.dcm');
      /** Everything a deletion could remove (rows and the stored files). */
      const snapshot = async () => ({
        patients: await rows('SELECT id, "deletedAt" FROM patients ORDER BY id'),
        studies: await rows('SELECT id FROM studies ORDER BY id'),
        series: await rows('SELECT id FROM series ORDER BY id'),
        images: await rows('SELECT id, "reviewState", "reviewStateSource" FROM patients_images ORDER BY id'),
        votes: await rows('SELECT id FROM patient_image_review_votes ORDER BY id'),
        voteEvents: await rows('SELECT id FROM patient_image_review_vote_events ORDER BY id'),
        resolutions: await rows('SELECT id, "supersededAt" FROM patient_image_review_resolutions ORDER BY id'),
        completions: await rows('SELECT id FROM patient_image_review_completions ORDER BY id'),
        seriesCompletions: await rows('SELECT id FROM series_review_completions ORDER BY id'),
        file: existsSync(seriesFile()),
        otherPatientFile: existsSync(seriesFile(OTHER_PATIENT, FOREIGN_SERIES)),
      });
      /** The other patient's data (never touched by deleting PATIENT). */
      const otherPatient = {
        patients: [{ id: OTHER_PATIENT, deletedAt: null }],
        studies: [{ id: OTHER_STUDY }],
        series: [{ id: FOREIGN_SERIES }],
        images: [{ id: id(20), reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE' }],
      };

      /** Reviewed data of PATIENT: a vote (+ history), a resolution, a completion, a file. */
      const reviewedSeries = async () => {
        const voted = await addImage(1);
        await addImage(2);
        await vote(voted, 'a', Vote.ABNORMAL);
        await review.setResolution(voted, ADMIN, { label: ReviewResolutionLabel.ABNORMAL });
        await completeSeries();
        await addImage(20, { series: FOREIGN_SERIES });
        for (const [patient, series] of [[PATIENT, SERIES], [OTHER_PATIENT, FOREIGN_SERIES]]) {
          await mkdir(path.dirname(seriesFile(patient, series)), { recursive: true });
          await writeFile(seriesFile(patient, series), 'synthetic');
        }
      };

      const expectFrozen = async (response: Response) => {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'REVIEW_FROZEN' });
      };
      const deletePatient = (patient = PATIENT, roles = 'dashboard:admin') =>
        call('POST', `/patients/${patient}/trash?type=delete`, { roles });

      it('permanent patient deletion is refused while frozen (nothing lost) and succeeds after unfreeze', async () => {
        await reviewedSeries();
        const before = await snapshot();
        expect(before).toMatchObject({ file: true, otherPatientFile: true });
        // Authorization is unchanged: admin only.
        expect((await deletePatient(PATIENT, '')).status).toBe(403);
        await review.freezeReview(ADMIN, 'export');

        await expectFrozen(await deletePatient());
        expect(await snapshot()).toEqual(before);

        await review.unfreezeReview(ADMIN);
        expect((await deletePatient()).status).toBe(200);
        // Patient -> Studies -> Series -> images -> review records, and the
        // patient's files (after the commit); the other patient is intact.
        expect(await snapshot()).toEqual({
          ...otherPatient,
          votes: [],
          voteEvents: [],
          resolutions: [],
          completions: [],
          seriesCompletions: [],
          file: false,
          otherPatientFile: true,
        });
      });

      it('a rolled-back patient deletion removes no file', async () => {
        await reviewedSeries();
        const before = await snapshot();
        const { Patient } = require('../db/models/Patient.model');
        const patient = await Patient.findByPk(PATIENT);

        await expect(
          review.withReviewFreezeGuard(async (transaction: import('sequelize').Transaction) => {
            await patient.destroy({ force: true, transaction });
            throw new Error('fails after the delete');
          })
        ).rejects.toThrow('fails after the delete');

        // Rolled back: rows and the file are all still there.
        expect(await snapshot()).toEqual(before);
      });

      it('moving a patient into or out of the trash is refused while frozen', async () => {
        await reviewedSeries();
        const trashed = async () =>
          (await rows('SELECT "deletedAt" IS NOT NULL AS trashed FROM patients WHERE id = $1', [PATIENT]))[0].trashed;
        await review.freezeReview(ADMIN, 'export');
        await expectFrozen(await call('DELETE', `/patients/${PATIENT}`));
        expect(await trashed()).toBe(false);

        await review.unfreezeReview(ADMIN);
        expect((await call('DELETE', `/patients/${PATIENT}`)).status).toBe(200);
        expect(await trashed()).toBe(true);

        await review.freezeReview(ADMIN, 'export');
        const before = await snapshot();
        await expectFrozen(
          await call('POST', `/patients/${PATIENT}/trash?type=restore`, { roles: 'dashboard:admin' })
        );
        expect(await snapshot()).toEqual(before);

        await review.unfreezeReview(ADMIN);
        expect(
          (await call('POST', `/patients/${PATIENT}/trash?type=restore`, { roles: 'dashboard:admin' })).status
        ).toBe(200);
        expect(await trashed()).toBe(false);
      });

      it('race: a deletion in flight completes before the freeze; after it, deletions are refused', async () => {
        await reviewedSeries();
        const release = gate();
        const locked = gate();
        // Holds the patient's image rows: the deletion (already past the
        // freeze check, holding the shared lock) waits on them.
        const blocker = sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM patients_images WHERE "seriesId" = $1 FOR UPDATE`,
            { bind: [SERIES], transaction }
          );
          locked.open();
          await release.opened;
        });
        await locked.opened;

        const deleting = deletePatient();
        expect(await settlesWithin(deleting, 500)).toBe(false);
        const freezing = review.freezeReview(ADMIN, 'export');
        // The freeze waits for the deletion in flight.
        expect(await settlesWithin(freezing, 500)).toBe(false);

        release.open();
        await blocker;
        expect((await deleting).status).toBe(200);
        await expect(freezing).resolves.toMatchObject({ frozen: true });
        expect((await snapshot()).patients).toEqual(otherPatient.patients);

        // After the freeze: refused, the other patient is intact.
        await expectFrozen(await deletePatient(OTHER_PATIENT));
        expect(await snapshot()).toMatchObject({ ...otherPatient, otherPatientFile: true });
      });

      it('race: a deletion during a freeze in flight is refused at once (REVIEW_LOCKED), nothing lost', async () => {
        await reviewedSeries();
        const before = await snapshot();
        const release = gate();
        const locked = gate();
        const freezing = sequelize.transaction(async (transaction) => {
          await sequelize.query('SELECT pg_advisory_xact_lock($1)', {
            bind: [review.REVIEW_FREEZE_LOCK_KEY],
            transaction,
          });
          await sequelize.query(
            `INSERT INTO review_freezes (id, reason, "frozenById", "frozenByName", "frozenAt")
             VALUES (gen_random_uuid(), 'export', 'sub-admin', 'Admin', now())`,
            { transaction }
          );
          locked.open();
          await release.opened;
        });
        await locked.opened;

        const expectLocked = async (response: Response) => {
          expect(response.status).toBe(409);
          expect(await response.json()).toMatchObject({ code: 'REVIEW_LOCKED' });
        };
        await expectLocked(await deletePatient());
        await expectLocked(await call('DELETE', `/patients/${OTHER_PATIENT}`));

        release.open();
        await freezing;
        await expectFrozen(await deletePatient());
        expect(await snapshot()).toEqual(before);
      });
    });

    describe('bulk votes over HTTP', () => {
      const votesUrl = (patient = PATIENT, series = SERIES) =>
        `/patients/${patient}/series/${series}/review/votes`;

      it('requires authentication; votes as the token user only, never as another', async () => {
        const [one, two] = [await addImage(1), await addImage(2)];
        const anonymous = await fetch(`${baseUrl}${votesUrl()}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ imageIds: [one], vote: 'abnormal' }),
        });
        expect(anonymous.status).toBe(401);

        await vote(one, 'b', Vote.NORMAL, 'b says normal');
        const response = await call('POST', votesUrl(), {
          user: 'a',
          // Unknown properties (e.g. a forged reviewer) are refused.
          body: { imageIds: [one, two], vote: 'abnormal', reviewerId: 'sub-b' },
        });
        expect(response.status).toBe(400);

        const ok = await call('POST', votesUrl(), { user: 'a', body: { imageIds: [one, two], vote: 'abnormal' } });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ requested: 2, created: 2, changed: 0, unchanged: 0 });
        expect(
          await rows(`SELECT "reviewerId", vote::text AS vote, comment FROM patient_image_review_votes WHERE "patientImageId" = $1 ORDER BY "reviewerId"`, [one])
        ).toEqual([
          { reviewerId: 'sub-a', vote: 'abnormal', comment: null },
          { reviewerId: 'sub-b', vote: 'normal', comment: 'b says normal' },
        ]);
      });

      it('validates the body and the patient -> series -> image chain', async () => {
        const mine = await addImage(1);
        const foreign = await addImage(2, { series: FOREIGN_SERIES });
        const post = (url: string, body: unknown) => call('POST', url, { body });
        expect((await post(votesUrl(), { imageIds: [mine], vote: 'maybe' })).status).toBe(400);
        expect((await post(votesUrl(), { imageIds: [], vote: 'normal' })).status).toBe(400);
        expect((await post(votesUrl(), { vote: 'normal' })).status).toBe(400);
        const crossSeries = await post(votesUrl(), { imageIds: [mine, foreign], vote: 'normal' });
        expect(crossSeries.status).toBe(400);
        expect(await crossSeries.json()).toMatchObject({ code: 'IMAGES_NOT_IN_SERIES' });
        // Another patient's series addressed through this patient: 404.
        expect((await post(votesUrl(PATIENT, FOREIGN_SERIES), { imageIds: [foreign], vote: 'normal' })).status).toBe(404);
        expect((await post(votesUrl('not-a-uuid', SERIES), { imageIds: [mine], vote: 'normal' })).status).toBe(404);
        expect(await rows('SELECT 1 FROM patient_image_review_votes')).toHaveLength(0);
      });

      it('is refused with a retryable 409 REVIEW_LOCKED while the labels are being captured', async () => {
        const image = await addImage(1);
        const release = gate();
        const locked = gate();
        const capture = sequelize.transaction(async (transaction) => {
          await sequelize.query('SELECT pg_advisory_xact_lock($1)', {
            bind: [review.REVIEW_FREEZE_LOCK_KEY],
            transaction,
          });
          locked.open();
          await release.opened;
        });
        await locked.opened;
        const refused = await call('POST', votesUrl(), { body: { imageIds: [image], vote: 'abnormal' } });
        expect(refused.status).toBe(409);
        expect(await refused.json()).toMatchObject({ code: 'REVIEW_LOCKED' });
        // Viewing is not blocked.
        expect((await call('GET', `/patients/${PATIENT}/series/${SERIES}`)).status).toBe(200);
        release.open();
        await capture;
        // Released: the retry succeeds.
        expect((await call('POST', votesUrl(), { body: { imageIds: [image], vote: 'abnormal' } })).status).toBe(200);
        expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL' });
      });
    });

    it('complete review, freeze and unfreeze over HTTP (409 REVIEW_FROZEN)', async () => {
      const image = await addImage(1);
      const complete = await call('POST', `/patients/${PATIENT}/series/${SERIES}/review/complete`, {
        body: { presentedImageIds: [image] },
      });
      expect(complete.status).toBe(200);
      expect(await complete.json()).toMatchObject({ imageCount: 1, implicitNormal: 1, skippedBroken: 0 });

      expect((await call('POST', '/review/freeze', { body: { reason: 'export' } })).status).toBe(403);
      const frozen = await call('POST', '/review/freeze', {
        roles: 'dashboard:admin',
        body: { reason: 'export' },
      });
      expect(frozen.status).toBe(200);
      expect(await (await call('GET', '/review/freeze')).json()).toMatchObject({
        frozen: true,
        reason: 'export',
      });

      const refused = await call('POST', `/patients/images/${image}/review-votes`, {
        body: { vote: 'abnormal', comment: null },
      });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ code: 'REVIEW_FROZEN' });
      expect(await stateOf(image)).toMatchObject({ reviewStateSource: 'FINISH_REVIEW' });

      expect((await call('POST', '/review/unfreeze', { roles: 'dashboard:admin' })).status).toBe(200);
      expect(
        (await call('POST', `/patients/images/${image}/review-votes`, {
          body: { vote: 'abnormal', comment: null },
        })).status
      ).toBe(204);
      expect(await stateOf(image)).toMatchObject({ reviewState: 'ABNORMAL', reviewStateSource: 'VOTES' });
    });
  });
});
