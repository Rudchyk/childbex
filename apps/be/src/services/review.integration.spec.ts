/**
 * Review semantics against PostgreSQL: effective state, vote history,
 * resolutions, "Finish review", the review freeze (including races with
 * mutations in flight) and the HTTP API with a fake Keycloak.
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
const CLUSTER = '22222222-2222-4222-8222-222222222222';
const OTHER_CLUSTER = '22222222-2222-4222-8222-222222222223';
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
    await sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
       VALUES ($1, 'Synthetic', 'synthetic', 'u', 'U', now(), now())`,
      { bind: [PATIENT] }
    );
    for (const [cluster, n] of [[CLUSTER, 0], [OTHER_CLUSTER, 1]] as const) {
      await sequelize.query(
        `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
         VALUES ($1, 'SYNTHETIC', $2, $3, now(), now())`,
        { bind: [cluster, n, PATIENT] }
      );
    }
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  // --- Helpers -----------------------------------------------------------------

  const addImage = async (
    n: number,
    { cluster = CLUSTER, broken = false } = {}
  ) => {
    await sequelize.query(
      `INSERT INTO patients_images (id, source, "clusterId", "isBrocken", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, now(), now())`,
      {
        bind: [id(n), `/uploads/p/c/IM${n}`, cluster, broken, broken ? 'broken' : 'not_reviewed'],
      }
    );
    return id(n);
  };

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

  // --- Finish review -----------------------------------------------------------------

  describe('finish review', () => {
    it('completes untouched images as NORMAL with provenance; a later vote overrides it', async () => {
      const untouched = await addImage(1);
      const voted = await addImage(2);
      const broken = await addImage(3, { broken: true });
      const resolved = await addImage(4);
      const elsewhere = await addImage(5, { cluster: OTHER_CLUSTER });
      await vote(voted, 'a', Vote.ABNORMAL);
      await review.setResolution(resolved, ADMIN, { label: ReviewResolutionLabel.NORMAL });

      const result = await review.finishClusterReview(CLUSTER, reviewer('f'));

      expect(result).toEqual({
        runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        completed: 1,
        alreadyReviewed: 2,
        skippedBroken: 1,
      });
      expect(
        await rows(
          `SELECT "patientImageId", "runId", "scopeClusterId", "completedById", "completedByName",
                  "createdAt" IS NOT NULL AS "hasCreatedAt"
           FROM patient_image_review_completions`
        )
      ).toEqual([
        {
          patientImageId: untouched,
          runId: result.runId,
          scopeClusterId: CLUSTER,
          completedById: 'sub-f',
          completedByName: 'Reviewer f',
          hasCreatedAt: true,
        },
      ]);
      expect(await stateOf(untouched)).toMatchObject({
        reviewState: 'NORMAL',
        reviewStateSource: 'FINISH_REVIEW',
        status: 'normal',
        votesCount: 0,
      });
      expect(await stateOf(voted)).toMatchObject({ reviewState: 'ABNORMAL', reviewStateSource: 'VOTES' });
      expect(await stateOf(broken)).toMatchObject({ reviewState: 'NOT_REVIEWED', status: 'broken' });
      expect(await stateOf(resolved)).toMatchObject({ reviewStateSource: 'RESOLUTION' });
      expect(await stateOf(elsewhere)).toMatchObject({ reviewState: 'NOT_REVIEWED' });

      // A later vote overrides the completion; the provenance stays.
      await vote(untouched, 'b', Vote.ABNORMAL);
      expect(await stateOf(untouched)).toMatchObject({
        reviewState: 'ABNORMAL',
        reviewStateSource: 'VOTES',
        isAbnormal: true,
      });
      expect(await rows('SELECT 1 FROM patient_image_review_completions')).toHaveLength(1);

      // Nothing left to complete.
      expect(await review.finishClusterReview(CLUSTER, reviewer('f'))).toMatchObject({
        completed: 0,
        alreadyReviewed: 3,
        skippedBroken: 1,
      });
    });

    it('rejects an unknown cluster', async () => {
      await expect(
        review.finishClusterReview('99999999-9999-4999-8999-999999999999', reviewer('f'))
      ).rejects.toMatchObject({ code: 'CLUSTER_NOT_FOUND', status: 404 });
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
      await expect(review.finishClusterReview(CLUSTER, reviewer('f'))).rejects.toMatchObject(frozen);
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

    it('race: a mutation waiting behind a freeze in flight is refused once the freeze commits', async () => {
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
      expect(await settlesWithin(voting, 500)).toBe(false); // waits for the freeze

      release.open();
      await freezing;
      await expect(voting).rejects.toMatchObject({ code: 'REVIEW_FROZEN' });
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

    it('resolution routes require the admin role; the cluster exposes the review state', async () => {
      const image = await addImage(1);
      const path = `/patients/images/${image}/review/resolution`;
      expect((await call('PUT', path, { body: { label: 'ABNORMAL' } })).status).toBe(403);
      expect(
        (await call('PUT', path, { roles: 'dashboard:admin', body: { label: 'MAYBE' } })).status
      ).toBe(400);
      expect(
        (await call('PUT', path, { roles: 'dashboard:admin', body: { label: 'ABNORMAL', comment: 'ok' } })).status
      ).toBe(204);

      const cluster = await (await call('GET', '/patients/slug/synthetic/clusters/cluster/0')).json();
      expect(cluster.images).toEqual([
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
      /** Everything a deletion could remove (rows and the cluster's files). */
      const snapshot = async () => ({
        patients: await rows('SELECT id, "deletedAt" FROM patients ORDER BY id'),
        clusters: await rows('SELECT id FROM patient_images_clusters ORDER BY id'),
        images: await rows('SELECT id, "reviewState", "reviewStateSource" FROM patients_images ORDER BY id'),
        votes: await rows('SELECT id FROM patient_image_review_votes ORDER BY id'),
        voteEvents: await rows('SELECT id FROM patient_image_review_vote_events ORDER BY id'),
        resolutions: await rows('SELECT id, "supersededAt" FROM patient_image_review_resolutions ORDER BY id'),
        completions: await rows('SELECT id FROM patient_image_review_completions ORDER BY id'),
        clusterFile: existsSync(path.join(uploadRoot(), PATIENT, CLUSTER, 'IM1')),
      });
      const uploadRoot = () => process.env.UPLOAD_ROOT as string;

      /** Reviewed data in CLUSTER: a vote (+ history), a resolution, a completion, a file. */
      const reviewedCluster = async () => {
        const voted = await addImage(1);
        await addImage(2);
        await vote(voted, 'a', Vote.ABNORMAL);
        await review.setResolution(voted, ADMIN, { label: ReviewResolutionLabel.ABNORMAL });
        await review.finishClusterReview(CLUSTER, reviewer('f'));
        await mkdir(path.join(uploadRoot(), PATIENT, CLUSTER), { recursive: true });
        await writeFile(path.join(uploadRoot(), PATIENT, CLUSTER, 'IM1'), 'synthetic');
      };

      const expectFrozen = async (response: Response) => {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: 'REVIEW_FROZEN' });
      };

      it('cluster deletion is refused while frozen (nothing lost) and succeeds after unfreeze', async () => {
        await reviewedCluster();
        const before = await snapshot();
        expect(before).toMatchObject({ clusterFile: true });
        await review.freezeReview(ADMIN, 'export');

        await expectFrozen(await call('DELETE', `/patients/clusters/${CLUSTER}`));
        expect(await snapshot()).toEqual(before);

        await review.unfreezeReview(ADMIN);
        expect((await call('DELETE', `/patients/clusters/${CLUSTER}`)).status).toBe(204);
        const after = await snapshot();
        expect(after.clusters).toEqual([{ id: OTHER_CLUSTER }]);
        expect(after).toMatchObject({
          images: [],
          votes: [],
          voteEvents: [],
          resolutions: [],
          completions: [],
          clusterFile: false,
        });
      });

      it('permanent patient deletion is refused while frozen (nothing lost) and succeeds after unfreeze', async () => {
        await reviewedCluster();
        const before = await snapshot();
        const deletePatient = (roles = 'dashboard:admin') =>
          call('POST', `/patients/${PATIENT}/trash?type=delete`, { roles });
        // Authorization is unchanged: admin only.
        expect((await deletePatient('')).status).toBe(403);
        await review.freezeReview(ADMIN, 'export');

        await expectFrozen(await deletePatient());
        expect(await snapshot()).toEqual(before);

        await review.unfreezeReview(ADMIN);
        expect((await deletePatient()).status).toBe(200);
        expect(await snapshot()).toEqual({
          patients: [],
          clusters: [],
          images: [],
          votes: [],
          voteEvents: [],
          resolutions: [],
          completions: [],
          clusterFile: false,
        });
      });

      it('moving a patient into or out of the trash is refused while frozen', async () => {
        await reviewedCluster();
        const trashed = async () =>
          (await rows('SELECT "deletedAt" IS NOT NULL AS trashed FROM patients'))[0].trashed;
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
        await reviewedCluster();
        await addImage(9, { cluster: OTHER_CLUSTER });
        const release = gate();
        const locked = gate();
        // Holds the images' rows: the deletion (already past the freeze
        // check, holding the shared lock) waits on them.
        const blocker = sequelize.transaction(async (transaction) => {
          await sequelize.query(
            `SELECT id FROM patients_images WHERE "clusterId" = $1 FOR UPDATE`,
            { bind: [CLUSTER], transaction }
          );
          locked.open();
          await release.opened;
        });
        await locked.opened;

        const deleting = call('DELETE', `/patients/clusters/${CLUSTER}`);
        expect(await settlesWithin(deleting, 500)).toBe(false);
        const freezing = review.freezeReview(ADMIN, 'export');
        // The freeze waits for the deletion in flight.
        expect(await settlesWithin(freezing, 500)).toBe(false);

        release.open();
        await blocker;
        expect((await deleting).status).toBe(204);
        await expect(freezing).resolves.toMatchObject({ frozen: true });
        expect((await snapshot()).clusters).toEqual([{ id: OTHER_CLUSTER }]);

        // After the freeze: refused, the other cluster is intact.
        await expectFrozen(await call('DELETE', `/patients/clusters/${OTHER_CLUSTER}`));
        expect((await snapshot()).images).toEqual([
          { id: id(9), reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE' },
        ]);
      });

      it('race: a deletion waiting behind a freeze in flight is refused once the freeze commits', async () => {
        await reviewedCluster();
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

        const deletingCluster = call('DELETE', `/patients/clusters/${CLUSTER}`);
        const deletingPatient = call('POST', `/patients/${PATIENT}/trash?type=delete`, {
          roles: 'dashboard:admin',
        });
        expect(await settlesWithin(deletingCluster, 500)).toBe(false);
        expect(await settlesWithin(deletingPatient, 100)).toBe(false);

        release.open();
        await freezing;
        await expectFrozen(await deletingCluster);
        await expectFrozen(await deletingPatient);
        const after = await snapshot();
        expect(after).toEqual(before);
      });
    });

    it('finish review, freeze and unfreeze over HTTP (409 REVIEW_FROZEN)', async () => {
      const image = await addImage(1);
      const finish = await call('POST', `/patients/clusters/${CLUSTER}/review/finish`);
      expect(finish.status).toBe(200);
      expect(await finish.json()).toMatchObject({ completed: 1, alreadyReviewed: 0, skippedBroken: 0 });

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
