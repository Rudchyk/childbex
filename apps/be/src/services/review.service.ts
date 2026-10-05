/**
 * Review semantics: the only writer of votes, vote history, resolutions,
 * Series review completions, review freezes and the cached review state of
 * images (no model hooks). The derivation itself is in review-state.ts.
 *
 * Every mutation, in one transaction: takes the review-freeze lock in shared
 * mode WITHOUT waiting (refused with 409 REVIEW_LOCKED while a dataset
 * snapshot captures the labels or the freeze changes, so requests never
 * queue up holding connections) and refuses while review is frozen; locks
 * the image row(s) in id order; changes the authoritative data; appends
 * history; recomputes all cached fields. Freezing and the dataset snapshot
 * capture take the same lock in exclusive mode, so they wait for mutations
 * in flight and no mutation can commit inside them. The lock is
 * transaction-scoped: PostgreSQL releases it on commit, rollback or a lost
 * connection (nothing can strand it).
 */
import { QueryTypes, type Transaction } from 'sequelize';
import {
  PatientImageReviewVoteTypes,
  ReviewResolutionLabel,
  type BulkReviewVoteResponse,
  type CompleteSeriesReviewResponse,
  type ReviewFreezeState,
} from '@libs/schemas';
import {
  deriveReviewCaches,
  diffReviewCaches,
  reviewCacheFields,
  type ReviewCaches,
} from './review-state';
import { sequelize } from '../db/sequelize';
import { PatientImage } from '../db/models/PatientImage.model';
import { PatientImageReviewVote } from '../db/models/PatientImageReviewVote.model';
import { PatientImageReviewVoteEvent } from '../db/models/PatientImageReviewVoteEvent.model';
import { PatientImageReviewResolution } from '../db/models/PatientImageReviewResolution.model';
import { PatientImageReviewCompletion } from '../db/models/PatientImageReviewCompletion.model';
import { ReviewFreeze } from '../db/models/ReviewFreeze.model';
import { SeriesReviewCompletion } from '../db/models/SeriesReviewCompletion.model';
import {
  findOwnedSeries,
  stackImageColumns,
  toStackImage,
  type StackImageRow,
} from './hierarchy.service';
import { isSimpleStack, orderSeriesImages } from './series-stack';
import { findImplicitNormals, imageSetRevision } from './series-review';

/** Advisory lock guarding review data against a freeze (shared/exclusive). */
export const REVIEW_FREEZE_LOCK_KEY = 4_352_002;

export interface Reviewer {
  id: string;
  name: string;
}

export type ReviewErrorCode =
  | 'REVIEW_FROZEN'
  | 'REVIEW_LOCKED'
  | 'INVALID_IMAGE_IDS'
  | 'IMAGES_NOT_IN_SERIES'
  | 'IMAGES_NOT_REVIEWABLE'
  | 'REVIEW_ALREADY_FROZEN'
  | 'REVIEW_NOT_FROZEN'
  | 'IMAGE_NOT_FOUND'
  | 'VOTE_NOT_FOUND'
  | 'SERIES_NOT_FOUND'
  | 'SERIES_NOT_FULLY_REVIEWABLE'
  | 'SERIES_CHANGED'
  | 'NO_ACTIVE_RESOLUTION'
  | 'NOTHING_TO_UPDATE';

const errorStatus: Record<ReviewErrorCode, 400 | 404 | 409> = {
  REVIEW_FROZEN: 409,
  REVIEW_LOCKED: 409,
  INVALID_IMAGE_IDS: 400,
  IMAGES_NOT_IN_SERIES: 400,
  IMAGES_NOT_REVIEWABLE: 400,
  REVIEW_ALREADY_FROZEN: 409,
  REVIEW_NOT_FROZEN: 409,
  IMAGE_NOT_FOUND: 404,
  VOTE_NOT_FOUND: 404,
  SERIES_NOT_FOUND: 404,
  SERIES_NOT_FULLY_REVIEWABLE: 409,
  SERIES_CHANGED: 409,
  NO_ACTIVE_RESOLUTION: 404,
  NOTHING_TO_UPDATE: 400,
};

export class ReviewError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(readonly code: ReviewErrorCode, message: string) {
    super(message);
    this.name = 'ReviewError';
    this.status = errorStatus[code];
  }
}

// --- Evidence and recomputation --------------------------------------------

export interface ImageReviewPlan {
  imageId: string;
  isBroken: boolean;
  stored: Pick<PatientImage, (typeof reviewCacheFields)[number]>;
  expected: ReviewCaches;
  changes: Partial<ReviewCaches>;
}

/** Loads the authoritative review data of images and derives their caches. */
export const planReviewCaches = async (
  imageIds: readonly string[],
  transaction?: Transaction
): Promise<ImageReviewPlan[]> => {
  if (!imageIds.length) return [];
  const ids = [...imageIds];
  // Sequentially: a transaction has a single connection.
  const images = await PatientImage.findAll({
    where: { id: ids },
    attributes: ['id', 'isBrocken', ...reviewCacheFields],
    order: [['id', 'ASC']],
    transaction,
  });
  const votes = await PatientImageReviewVote.findAll({
    where: { patientImageId: ids },
    attributes: ['patientImageId', 'vote'],
    transaction,
  });
  const resolutions = await PatientImageReviewResolution.findAll({
    where: { patientImageId: ids, supersededAt: null },
    transaction,
  });
  const completions = await PatientImageReviewCompletion.findAll({
    where: { patientImageId: ids },
    attributes: ['patientImageId'],
    transaction,
  });
  const implicitNormals = await findImplicitNormals(ids, transaction);
  const votesByImage = new Map<string, PatientImageReviewVoteTypes[]>();
  for (const { patientImageId, vote } of votes) {
    votesByImage.set(patientImageId, [
      ...(votesByImage.get(patientImageId) ?? []),
      vote,
    ]);
  }
  const resolutionByImage = new Map(
    resolutions.map((resolution) => [resolution.patientImageId, resolution])
  );
  const completed = new Set(completions.map((c) => c.patientImageId));

  return images.map((image) => {
    const expected = deriveReviewCaches(
      {
        votes: votesByImage.get(image.id) ?? [],
        implicitNormals: implicitNormals.get(image.id)?.length ?? 0,
        resolution: resolutionByImage.get(image.id) ?? null,
        completed: completed.has(image.id),
      },
      image.isBrocken
    );
    const stored = image.get({ plain: true }) as ImageReviewPlan['stored'];
    return {
      imageId: image.id,
      isBroken: image.isBrocken,
      stored,
      expected,
      changes: diffReviewCaches(stored, expected),
    };
  });
};

/**
 * Recomputes and stores the cached review fields of images (inside the
 * caller's transaction, after their rows were locked). `silent` keeps
 * `updatedAt` (maintenance commands).
 */
export const recomputeReviewCaches = async (
  imageIds: readonly string[],
  transaction: Transaction,
  { silent = false }: { silent?: boolean } = {}
): Promise<ImageReviewPlan[]> => {
  const plans = await planReviewCaches(imageIds, transaction);
  // One UPDATE per distinct change (a Series review completion typically
  // changes hundreds of images the same way).
  const groups = new Map<string, { changes: Partial<ReviewCaches>; ids: string[] }>();
  for (const { imageId, changes } of plans) {
    if (!Object.keys(changes).length) continue;
    const key = JSON.stringify(changes);
    const group = groups.get(key);
    if (group) group.ids.push(imageId);
    else groups.set(key, { changes, ids: [imageId] });
  }
  for (const { changes, ids } of groups.values()) {
    // `resolvedAt` is typed as the API's ISO string; Sequelize takes a Date.
    await PatientImage.update(changes as never, {
      where: { id: ids },
      transaction,
      silent,
    });
  }
  return plans;
};

// --- Freeze lock -----------------------------------------------------------

const findActiveFreeze = (transaction?: Transaction) =>
  ReviewFreeze.findOne({
    where: { scope: 'global', unfrozenAt: null },
    transaction,
  });

/**
 * Takes the review-freeze lock in shared mode (until the transaction ends)
 * without waiting: while a dataset snapshot capture or a freeze change holds
 * (or waits for) the exclusive lock, the mutation is refused at once with
 * REVIEW_LOCKED (retryable, typically within seconds). Then refuses while
 * review is frozen. Read after the lock: a freeze committed before it is
 * always seen (READ COMMITTED, new snapshot).
 */
export const acquireReviewMutationLock = async (transaction: Transaction) => {
  const [{ locked }] = await sequelize.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_xact_lock_shared(:key) AS locked',
    {
      replacements: { key: REVIEW_FREEZE_LOCK_KEY },
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  if (!locked) {
    throw new ReviewError(
      'REVIEW_LOCKED',
      'Review labels are locked for a moment while a dataset snapshot is captured; try again shortly.'
    );
  }
  if (await findActiveFreeze(transaction)) {
    throw new ReviewError(
      'REVIEW_FROZEN',
      'Review is frozen: review data cannot be changed.'
    );
  }
};

const acquireReviewFreezeLock = (transaction: Transaction) =>
  sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
    replacements: { key: REVIEW_FREEZE_LOCK_KEY },
    transaction,
  });

/**
 * Runs `run` in a transaction under the review-freeze protocol (shared lock,
 * refused with REVIEW_LOCKED while it is taken exclusively and with
 * REVIEW_FROZEN while frozen). Used by every review mutation and
 * by operations that remove reviewed images or change which patients are
 * active (patient deletion, trash, restore): `run` must do all its
 * database changes in the given transaction.
 */
export const withReviewFreezeGuard = <T>(
  run: (transaction: Transaction) => Promise<T>
) =>
  sequelize.transaction(async (transaction) => {
    await acquireReviewMutationLock(transaction);
    return run(transaction);
  });

const reviewMutation = withReviewFreezeGuard;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const lockImage = async (imageId: string, transaction: Transaction) => {
  const image = UUID.test(imageId)
    ? await PatientImage.findByPk(imageId, {
        attributes: ['id'],
        lock: transaction.LOCK.UPDATE,
        transaction,
      })
    : null;
  if (!image) {
    throw new ReviewError('IMAGE_NOT_FOUND', 'The image does not exist.');
  }
};

// --- Votes -----------------------------------------------------------------

export interface VoteInput {
  vote: PatientImageReviewVoteTypes;
  comment?: string | null;
}

const changeVote = async (
  existing: PatientImageReviewVote,
  reviewer: Reviewer,
  { vote, comment = null }: VoteInput,
  transaction: Transaction
) => {
  if (existing.vote === vote && existing.comment === comment) return false;
  await PatientImageReviewVoteEvent.create(
    {
      patientImageId: existing.patientImageId,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      action: 'changed',
      previousVote: existing.vote,
      newVote: vote,
      previousComment: existing.comment,
      newComment: comment,
      createdAt: new Date(),
    },
    { transaction }
  );
  await existing.update(
    { vote, comment, reviewerName: reviewer.name },
    { transaction }
  );
  await recomputeReviewCaches([existing.patientImageId], transaction);
  return true;
};

/**
 * Casts the reviewer's vote on an image, or changes it (one vote per
 * reviewer and image; repeating the same vote changes nothing).
 */
export const castVote = (imageId: string, reviewer: Reviewer, input: VoteInput) =>
  reviewMutation(async (transaction) => {
    await lockImage(imageId, transaction);
    const existing = await PatientImageReviewVote.findOne({
      where: { patientImageId: imageId, reviewerId: reviewer.id },
      transaction,
    });
    if (existing) {
      await changeVote(existing, reviewer, input, transaction);
      return existing;
    }
    const comment = input.comment ?? null;
    const vote = await PatientImageReviewVote.create(
      {
        patientImageId: imageId,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        vote: input.vote,
        comment,
      },
      { transaction }
    );
    await PatientImageReviewVoteEvent.create(
      {
        patientImageId: imageId,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        action: 'cast',
        previousVote: null,
        newVote: input.vote,
        previousComment: null,
        newComment: comment,
        createdAt: new Date(),
      },
      { transaction }
    );
    await recomputeReviewCaches([imageId], transaction);
    return vote;
  });

/**
 * Changes a vote: only the reviewer's own vote on that image (any other
 * vote, of another reviewer or another image, is "not found").
 */
export const changeOwnVote = (
  imageId: string,
  voteId: string,
  reviewer: Reviewer,
  input: VoteInput
) =>
  reviewMutation(async (transaction) => {
    await lockImage(imageId, transaction);
    const existing = UUID.test(voteId)
      ? await PatientImageReviewVote.findOne({
          where: {
            id: voteId,
            patientImageId: imageId,
            reviewerId: reviewer.id,
          },
          transaction,
        })
      : null;
    if (!existing) {
      throw new ReviewError('VOTE_NOT_FOUND', 'The vote does not exist.');
    }
    if (!(await changeVote(existing, reviewer, input, transaction))) {
      throw new ReviewError('NOTHING_TO_UPDATE', 'Nothing to update.');
    }
    return existing;
  });

// --- Resolutions -----------------------------------------------------------

const supersedeActiveResolution = async (
  imageId: string,
  actor: Reviewer,
  transaction: Transaction
) => {
  const [superseded] = await PatientImageReviewResolution.update(
    {
      supersededAt: new Date(),
      supersededById: actor.id,
      supersededByName: actor.name,
    },
    { where: { patientImageId: imageId, supersededAt: null }, transaction }
  );
  return superseded;
};

/** Sets an admin resolution (the previous one is kept as history). */
export const setResolution = (
  imageId: string,
  admin: Reviewer,
  { label, comment = null }: { label: ReviewResolutionLabel; comment?: string | null }
) =>
  reviewMutation(async (transaction) => {
    await lockImage(imageId, transaction);
    await supersedeActiveResolution(imageId, admin, transaction);
    await PatientImageReviewResolution.create(
      {
        patientImageId: imageId,
        label,
        origin: 'admin',
        resolverId: admin.id,
        resolverName: admin.name,
        comment,
        createdAt: new Date(),
      },
      { transaction }
    );
    const [plan] = await recomputeReviewCaches([imageId], transaction);
    return plan.expected;
  });

/** Removes the active resolution: votes / completion decide again. */
export const removeResolution = (imageId: string, admin: Reviewer) =>
  reviewMutation(async (transaction) => {
    await lockImage(imageId, transaction);
    if (!(await supersedeActiveResolution(imageId, admin, transaction))) {
      throw new ReviewError(
        'NO_ACTIVE_RESOLUTION',
        'The image has no active resolution.'
      );
    }
    const [plan] = await recomputeReviewCaches([imageId], transaction);
    return plan.expected;
  });

// --- Series review: bulk votes and Complete review ------------------------------

/** Most images one bulk vote may change (a CT Series has up to ~1000+). */
export const MAX_BULK_VOTE_IMAGES = 5000;

/**
 * Locks (in id order) the given images of a Series of the patient and checks
 * that every one of them is a non-broken image of that Series. Unknown ids,
 * images of another Series or patient, and broken images (never shown) are
 * refused as a whole; nothing is changed.
 */
const lockSeriesImages = async (
  patientId: string,
  seriesId: string,
  imageIds: readonly string[],
  transaction: Transaction
) => {
  const ids = [...new Set(imageIds)];
  if (!ids.length || ids.length > MAX_BULK_VOTE_IMAGES || !ids.every((id) => UUID.test(id))) {
    throw new ReviewError(
      'INVALID_IMAGE_IDS',
      `Between 1 and ${MAX_BULK_VOTE_IMAGES} valid image ids are required.`
    );
  }
  if (!(await findOwnedSeries(patientId, seriesId, transaction))) {
    throw new ReviewError('SERIES_NOT_FOUND', 'The series does not exist.');
  }
  const rows = await sequelize.query<{ id: string; isBrocken: boolean }>(
    `SELECT id, "isBrocken" FROM patients_images
     WHERE "seriesId" = :seriesId AND id IN (:ids) ORDER BY id FOR UPDATE`,
    { replacements: { seriesId, ids }, type: QueryTypes.SELECT, transaction }
  );
  if (rows.length !== ids.length) {
    throw new ReviewError(
      'IMAGES_NOT_IN_SERIES',
      `${ids.length - rows.length} of the selected images are not images of this series; reload the series.`
    );
  }
  if (rows.some(({ isBrocken }) => isBrocken)) {
    throw new ReviewError(
      'IMAGES_NOT_REVIEWABLE',
      'Broken images cannot be reviewed.'
    );
  }
  return ids;
};

/**
 * Sets the reviewer's own vote on many images of one Series at once (one
 * transaction: all or nothing). Only the reviewer's votes change; other
 * reviewers' votes are never read for writing. Repeating the same vote
 * changes nothing (idempotent). An existing comment is kept: a bulk action
 * never discards a reviewer's free text.
 */
export const castBulkVote = (
  patientId: string,
  seriesId: string,
  reviewer: Reviewer,
  imageIds: readonly string[],
  vote: PatientImageReviewVoteTypes
): Promise<BulkReviewVoteResponse> =>
  reviewMutation(async (transaction) => {
    const ids = await lockSeriesImages(patientId, seriesId, imageIds, transaction);
    const existing = await PatientImageReviewVote.findAll({
      where: { patientImageId: ids, reviewerId: reviewer.id },
      transaction,
    });
    const byImage = new Map(existing.map((row) => [row.patientImageId, row]));
    const toCreate = ids.filter((id) => !byImage.has(id));
    const toChange = existing.filter((row) => row.vote !== vote);
    const createdAt = new Date();

    if (toCreate.length) {
      await PatientImageReviewVote.bulkCreate(
        toCreate.map((patientImageId) => ({
          patientImageId,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          vote,
          comment: null,
        })),
        { transaction }
      );
    }
    if (toChange.length) {
      await PatientImageReviewVote.update(
        { vote, reviewerName: reviewer.name },
        { where: { id: toChange.map(({ id }) => id) }, transaction }
      );
    }
    await PatientImageReviewVoteEvent.bulkCreate(
      [
        ...toCreate.map((patientImageId) => ({
          patientImageId,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          action: 'cast' as const,
          previousVote: null,
          newVote: vote,
          previousComment: null,
          newComment: null,
          createdAt,
        })),
        ...toChange.map((row) => ({
          patientImageId: row.patientImageId,
          reviewerId: reviewer.id,
          reviewerName: reviewer.name,
          action: 'changed' as const,
          previousVote: row.vote,
          newVote: vote,
          previousComment: row.comment,
          newComment: row.comment,
          createdAt,
        })),
      ],
      { transaction }
    );
    await recomputeReviewCaches(
      [...toCreate, ...toChange.map(({ patientImageId }) => patientImageId)],
      transaction
    );
    return {
      requested: ids.length,
      created: toCreate.length,
      changed: toChange.length,
      unchanged: ids.length - toCreate.length - toChange.length,
    };
  });

/**
 * "Complete review" of a DICOM Series by a reviewer: "I reviewed every image
 * of this Series; every image I did not mark is NORMAL according to me".
 *
 * Records one append-only completion (reviewer, time, exactly the presented
 * image set and its revision); creates no vote rows. The reviewer's explicit
 * votes stay as they are; every other presented image gets the reviewer's
 * implicit NORMAL opinion. Other reviewers' data is untouched. It is not a
 * lock: the reviewer can vote on any image later, and completing again
 * records a new completion (the latest one counts).
 *
 * Only for a Series the viewer shows completely (one orientation, no
 * multi-frame image), and only when the non-broken images are exactly those
 * the reviewer was shown (`presentedImageIds`): an image that was not
 * presented is never covered. Checked on the locked rows.
 */
export const completeSeriesReview = (
  patientId: string,
  seriesId: string,
  reviewer: Reviewer,
  presentedImageIds: readonly string[]
): Promise<CompleteSeriesReviewResponse> =>
  reviewMutation(async (transaction) => {
    if (!(await findOwnedSeries(patientId, seriesId, transaction))) {
      throw new ReviewError('SERIES_NOT_FOUND', 'The series does not exist.');
    }
    // In id order: concurrent runs never deadlock on the rows.
    const rows = await sequelize.query<StackImageRow>(
      `SELECT ${stackImageColumns} FROM patients_images
       WHERE "seriesId" = :seriesId ORDER BY id FOR UPDATE`,
      { replacements: { seriesId }, type: QueryTypes.SELECT, transaction }
    );
    const stack = orderSeriesImages(rows.map(toStackImage));
    if (!isSimpleStack(stack)) {
      throw new ReviewError(
        'SERIES_NOT_FULLY_REVIEWABLE',
        'The series has several orientations or geometries, incomplete ' +
          'geometry or multi-frame images; the viewer cannot show it ' +
          'completely, so it cannot be completed as a whole.'
      );
    }
    const displayed = new Set(
      stack.images.filter(({ image }) => !image.isBroken).map(({ image }) => image.id)
    );
    const presented = new Set(presentedImageIds);
    if (
      !displayed.size ||
      displayed.size !== presented.size ||
      [...displayed].some((id) => !presented.has(id))
    ) {
      throw new ReviewError(
        'SERIES_CHANGED',
        'The series images differ from the images that were presented; reload the series.'
      );
    }
    const imageIds = [...displayed].sort();
    const completion = await SeriesReviewCompletion.create(
      {
        seriesId,
        reviewerId: reviewer.id,
        reviewerName: reviewer.name,
        imageIds,
        imageCount: imageIds.length,
        imageSetHash: imageSetRevision(imageIds),
        completedAt: new Date(),
      },
      { transaction }
    );
    const ownVotes = await PatientImageReviewVote.findAll({
      where: { patientImageId: imageIds, reviewerId: reviewer.id },
      attributes: ['vote'],
      transaction,
    });
    const count = (value: PatientImageReviewVoteTypes) =>
      ownVotes.filter(({ vote }) => vote === value).length;
    await recomputeReviewCaches(imageIds, transaction);
    return {
      completionId: completion.id,
      completedAt: completion.completedAt.toISOString(),
      imageSetRevision: completion.imageSetHash,
      imageCount: imageIds.length,
      explicitAbnormal: count(PatientImageReviewVoteTypes.ABNORMAL),
      explicitUncertain: count(PatientImageReviewVoteTypes.UNCERTAIN),
      explicitNormal: count(PatientImageReviewVoteTypes.NORMAL),
      implicitNormal: imageIds.length - ownVotes.length,
      skippedBroken: rows.length - imageIds.length,
    };
  });

// --- Freeze ------------------------------------------------------------------

const freezeState = (freeze: ReviewFreeze | null): ReviewFreezeState => ({
  frozen: !!freeze,
  reason: freeze?.reason ?? null,
  frozenAt: freeze?.frozenAt.toISOString() ?? null,
  frozenByName: freeze?.frozenByName ?? null,
});

export const getReviewFreezeState = async () =>
  freezeState(await findActiveFreeze());

/**
 * Freezes review globally. Waits for review mutations in flight (exclusive
 * lock); once committed, every later mutation is refused.
 */
export const freezeReview = (admin: Reviewer, reason: string) =>
  sequelize.transaction(async (transaction) => {
    await acquireReviewFreezeLock(transaction);
    if (await findActiveFreeze(transaction)) {
      throw new ReviewError('REVIEW_ALREADY_FROZEN', 'Review is already frozen.');
    }
    const freeze = await ReviewFreeze.create(
      {
        reason,
        frozenById: admin.id,
        frozenByName: admin.name,
        frozenAt: new Date(),
      },
      { transaction }
    );
    return freezeState(freeze);
  });

export const unfreezeReview = (admin: Reviewer) =>
  sequelize.transaction(async (transaction) => {
    await acquireReviewFreezeLock(transaction);
    const freeze = await findActiveFreeze(transaction);
    if (!freeze) {
      throw new ReviewError('REVIEW_NOT_FROZEN', 'Review is not frozen.');
    }
    await freeze.update(
      {
        unfrozenAt: new Date(),
        unfrozenById: admin.id,
        unfrozenByName: admin.name,
      },
      { transaction }
    );
    return freezeState(null);
  });

