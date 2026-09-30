/**
 * Review semantics: the only writer of votes, vote history, resolutions,
 * "Finish review" completions, review freezes and the cached review state of
 * images (no model hooks). The derivation itself is in review-state.ts.
 *
 * Every mutation, in one transaction: takes the review-freeze lock in shared
 * mode and refuses while review is frozen; locks the image row(s); changes
 * the authoritative data; appends history; recomputes all cached fields.
 * Freezing takes the same lock in exclusive mode, so it waits for mutations
 * in flight and no mutation can commit after a freeze.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';
import {
  PatientImageReviewVoteTypes,
  ReviewResolutionLabel,
  type FinishReviewResponse,
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
import { PatientImagesCluster } from '../db/models/PatientImagesCluster.model';
import { PatientImageReviewVote } from '../db/models/PatientImageReviewVote.model';
import { PatientImageReviewVoteEvent } from '../db/models/PatientImageReviewVoteEvent.model';
import { PatientImageReviewResolution } from '../db/models/PatientImageReviewResolution.model';
import { PatientImageReviewCompletion } from '../db/models/PatientImageReviewCompletion.model';
import { ReviewFreeze } from '../db/models/ReviewFreeze.model';
import {
  findOwnedSeries,
  stackImageColumns,
  toStackImage,
  type StackImageRow,
} from './hierarchy.service';
import { isSimpleStack, orderSeriesImages } from './series-stack';

/** Advisory lock guarding review data against a freeze (shared/exclusive). */
export const REVIEW_FREEZE_LOCK_KEY = 4_352_002;

export interface Reviewer {
  id: string;
  name: string;
}

export type ReviewErrorCode =
  | 'REVIEW_FROZEN'
  | 'REVIEW_ALREADY_FROZEN'
  | 'REVIEW_NOT_FROZEN'
  | 'IMAGE_NOT_FOUND'
  | 'VOTE_NOT_FOUND'
  | 'CLUSTER_NOT_FOUND'
  | 'SERIES_NOT_FOUND'
  | 'SERIES_NOT_FULLY_REVIEWABLE'
  | 'SERIES_CHANGED'
  | 'NO_ACTIVE_RESOLUTION'
  | 'NOTHING_TO_UPDATE';

const errorStatus: Record<ReviewErrorCode, 400 | 404 | 409> = {
  REVIEW_FROZEN: 409,
  REVIEW_ALREADY_FROZEN: 409,
  REVIEW_NOT_FROZEN: 409,
  IMAGE_NOT_FOUND: 404,
  VOTE_NOT_FOUND: 404,
  CLUSTER_NOT_FOUND: 404,
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
  for (const { imageId, changes } of plans) {
    if (!Object.keys(changes).length) continue;
    // `resolvedAt` is typed as the API's ISO string; Sequelize takes a Date.
    await PatientImage.update(changes as never, {
      where: { id: imageId },
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
 * and refuses while review is frozen. Read after the lock: a freeze
 * committed before it is always seen (READ COMMITTED, new snapshot).
 */
export const acquireReviewMutationLock = async (transaction: Transaction) => {
  await sequelize.query('SELECT pg_advisory_xact_lock_shared(:key)', {
    replacements: { key: REVIEW_FREEZE_LOCK_KEY },
    transaction,
  });
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
 * refused with REVIEW_FROZEN while frozen). Used by every review mutation and
 * by operations that remove reviewed images or change which patients are
 * active (cluster / patient deletion, trash, restore): `run` must do all its
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

// --- Finish review -----------------------------------------------------------

/**
 * Completes as NORMAL every non-broken image (rows locked by the caller)
 * without votes, an active resolution or an earlier completion: one
 * completion record per image, sharing a run id, with the given scope.
 * Images with any review data are left as they are.
 */
const completeUntouchedImages = async (
  images: readonly { id: string; isBrocken: boolean }[],
  scope: { scopeClusterId: string } | { scopeSeriesId: string },
  reviewer: Reviewer,
  transaction: Transaction
): Promise<FinishReviewResponse> => {
  const reviewable = images.filter((image) => !image.isBrocken);
  const ids = reviewable.map(({ id }) => id);
  const reviewed = new Set<string>();
  if (ids.length) {
    const rows = await sequelize.query<{ id: string }>(
      `SELECT "patientImageId" AS id FROM patient_image_review_votes
         WHERE "patientImageId" IN (:ids)
       UNION
       SELECT "patientImageId" FROM patient_image_review_resolutions
         WHERE "patientImageId" IN (:ids) AND "supersededAt" IS NULL
       UNION
       SELECT "patientImageId" FROM patient_image_review_completions
         WHERE "patientImageId" IN (:ids)`,
      { replacements: { ids }, type: QueryTypes.SELECT, transaction }
    );
    for (const { id } of rows) reviewed.add(id);
  }
  const toComplete = ids.filter((id) => !reviewed.has(id));
  const runId = randomUUID();
  const createdAt = new Date();
  await PatientImageReviewCompletion.bulkCreate(
    toComplete.map((patientImageId) => ({
      patientImageId,
      runId,
      scopeClusterId: null,
      scopeSeriesId: null,
      ...scope,
      completedById: reviewer.id,
      completedByName: reviewer.name,
      createdAt,
    })),
    { transaction }
  );
  await recomputeReviewCaches(toComplete, transaction);
  return {
    runId,
    completed: toComplete.length,
    alreadyReviewed: reviewed.size,
    skippedBroken: images.length - reviewable.length,
  };
};

/**
 * Legacy "Finish review" of a cluster (kept for older clients during the
 * move to Series; the GUI uses `finishSeriesReview`).
 */
export const finishClusterReview = (
  clusterId: string,
  reviewer: Reviewer
): Promise<FinishReviewResponse> =>
  reviewMutation(async (transaction) => {
    const cluster = UUID.test(clusterId)
      ? await PatientImagesCluster.findByPk(clusterId, {
          attributes: ['id'],
          transaction,
        })
      : null;
    if (!cluster) {
      throw new ReviewError('CLUSTER_NOT_FOUND', 'The cluster does not exist.');
    }
    // In id order: two concurrent runs never deadlock on the rows.
    const images = await sequelize.query<{ id: string; isBrocken: boolean }>(
      `SELECT id, "isBrocken" FROM patients_images
       WHERE "clusterId" = :clusterId ORDER BY id FOR UPDATE`,
      { replacements: { clusterId }, type: QueryTypes.SELECT, transaction }
    );
    return completeUntouchedImages(
      images,
      { scopeClusterId: clusterId },
      reviewer,
      transaction
    );
  });

/**
 * "Finish review" of a DICOM Series of the patient. Only for a Series the
 * viewer shows completely (one orientation, no multi-frame image), and only
 * when the non-broken images are exactly those the reviewer was shown
 * (`presentedImageIds`): an image that was not presented is never
 * completed. Checked on the locked rows.
 */
export const finishSeriesReview = (
  patientId: string,
  seriesId: string,
  reviewer: Reviewer,
  presentedImageIds: readonly string[]
): Promise<FinishReviewResponse> =>
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
        'The series has several orientations or multi-frame images; the ' +
          'viewer cannot show it completely, so it cannot be finished as a whole.'
      );
    }
    const displayed = new Set(
      stack.images.filter(({ image }) => !image.isBroken).map(({ image }) => image.id)
    );
    const presented = new Set(presentedImageIds);
    if (
      displayed.size !== presented.size ||
      [...displayed].some((id) => !presented.has(id))
    ) {
      throw new ReviewError(
        'SERIES_CHANGED',
        'The series images differ from the images that were presented; reload the series.'
      );
    }
    return completeUntouchedImages(
      rows.map(({ id, isBrocken }) => ({ id, isBrocken })),
      { scopeSeriesId: seriesId },
      reviewer,
      transaction
    );
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

