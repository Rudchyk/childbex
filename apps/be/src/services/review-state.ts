/**
 * Effective review state of an image and its cached fields (pure; no
 * database access).
 *
 * Every reviewer has at most one opinion per image: their explicit vote, or
 * else an IMPLICIT NORMAL when their latest completed review of the image's
 * Series covered the image (radiologist workflow: doctors mark Abnormal /
 * Not sure, everything else they reviewed is Normal). Opinions of different
 * reviewers are never merged into one label; precedence:
 *   1. an active admin resolution  -> its label                  (RESOLUTION)
 *   2. opinions (explicit votes and implicit NORMALs):
 *        one distinct label        -> that label   (VOTES; FINISH_REVIEW when
 *                                                   all are implicit NORMAL)
 *        several labels            -> CONFLICTED                  (VOTES)
 *   3. a legacy per-image "Finish review" completion -> NORMAL (FINISH_REVIEW)
 *   4. otherwise                   -> NOT_REVIEWED                (NONE)
 */
import {
  PatientImageReviewVoteTypes,
  PatientImageStatus,
  ReviewResolutionLabel,
  ReviewState,
  ReviewStateSource,
} from '@libs/schemas';

/** The fields of the active resolution the caches are derived from. */
export interface ActiveResolution {
  label: ReviewResolutionLabel | null;
  resolverId: string | null;
  resolverName: string | null;
  comment: string | null;
  legacyResolvedAt: Date | null;
  createdAt: Date;
}

export interface ReviewEvidence {
  /** Explicit votes (one per reviewer). */
  votes: readonly PatientImageReviewVoteTypes[];
  /**
   * Implicit NORMAL opinions: reviewers whose latest completed Series review
   * covers the image and who have no explicit vote on it.
   */
  implicitNormals?: number;
  /** The active resolution, if any. */
  resolution: ActiveResolution | null;
  /** A legacy per-image "Finish review" completion exists. */
  completed: boolean;
}

export interface DerivedReviewState {
  reviewState: ReviewState;
  reviewStateSource: ReviewStateSource;
}

const voteState: Record<PatientImageReviewVoteTypes, ReviewState> = {
  [PatientImageReviewVoteTypes.NORMAL]: ReviewState.NORMAL,
  [PatientImageReviewVoteTypes.ABNORMAL]: ReviewState.ABNORMAL,
  [PatientImageReviewVoteTypes.UNCERTAIN]: ReviewState.UNCERTAIN,
};

const resolutionState: Record<ReviewResolutionLabel, ReviewState> = {
  [ReviewResolutionLabel.NORMAL]: ReviewState.NORMAL,
  [ReviewResolutionLabel.ABNORMAL]: ReviewState.ABNORMAL,
  [ReviewResolutionLabel.UNCERTAIN]: ReviewState.UNCERTAIN,
};

/**
 * The effective review state. Any disagreement between reviewers' opinions
 * is CONFLICTED (no majority; an implicit NORMAL disagrees with an explicit
 * ABNORMAL / UNCERTAIN like an explicit NORMAL does); only UNCERTAIN
 * opinions are UNCERTAIN; no opinion is NOT_REVIEWED unless a legacy
 * completion exists.
 */
export const deriveReviewState = ({
  votes,
  implicitNormals = 0,
  resolution,
  completed,
}: ReviewEvidence): DerivedReviewState => {
  if (resolution?.label) {
    return {
      reviewState: resolutionState[resolution.label],
      reviewStateSource: ReviewStateSource.RESOLUTION,
    };
  }
  const labels = new Set(votes);
  if (implicitNormals > 0) labels.add(PatientImageReviewVoteTypes.NORMAL);
  if (labels.size === 1) {
    return {
      reviewState: voteState[[...labels][0]],
      reviewStateSource: votes.length
        ? ReviewStateSource.VOTES
        : ReviewStateSource.FINISH_REVIEW,
    };
  }
  if (labels.size > 1) {
    return {
      reviewState: ReviewState.CONFLICTED,
      reviewStateSource: ReviewStateSource.VOTES,
    };
  }
  if (completed) {
    return {
      reviewState: ReviewState.NORMAL,
      reviewStateSource: ReviewStateSource.FINISH_REVIEW,
    };
  }
  return {
    reviewState: ReviewState.NOT_REVIEWED,
    reviewStateSource: ReviewStateSource.NONE,
  };
};

/** All cached review fields of an image. */
export interface ReviewCaches extends DerivedReviewState {
  status: PatientImageStatus;
  isAbnormal: boolean;
  votesCount: number;
  normalVotes: number;
  abnormalVotes: number;
  uncertainVotes: number;
  adminResolutionId: string | null;
  adminResolutionName: string | null;
  resolutionComment: string | null;
  resolvedAt: Date | null;
}

export const reviewCacheFields = [
  'reviewState',
  'reviewStateSource',
  'status',
  'isAbnormal',
  'votesCount',
  'normalVotes',
  'abnormalVotes',
  'uncertainVotes',
  'adminResolutionId',
  'adminResolutionName',
  'resolutionComment',
  'resolvedAt',
] as const satisfies readonly (keyof ReviewCaches)[];

const stateStatus: Record<ReviewState, PatientImageStatus> = {
  [ReviewState.NOT_REVIEWED]: PatientImageStatus.NOT_REVIEWED,
  [ReviewState.NORMAL]: PatientImageStatus.NORMAL,
  [ReviewState.ABNORMAL]: PatientImageStatus.ABNORMAL,
  [ReviewState.UNCERTAIN]: PatientImageStatus.UNCERTAIN,
  [ReviewState.CONFLICTED]: PatientImageStatus.CONFLICTED,
};

/**
 * The effective state plus the compatibility caches: the legacy `status`
 * (`broken` for broken images, `admin_resolved` for a resolution),
 * `isAbnormal` (only for an ABNORMAL state), the vote counters (explicit
 * votes only: an implicit NORMAL is not a vote) and the legacy resolution
 * fields (from the active resolution, else null). `isAbnormal = false` is
 * never proof of agreement on NORMAL: read `reviewState`.
 */
export const deriveReviewCaches = (
  evidence: ReviewEvidence,
  isBroken: boolean
): ReviewCaches => {
  const derived = deriveReviewState(evidence);
  const count = (vote: PatientImageReviewVoteTypes) =>
    evidence.votes.filter((value) => value === vote).length;
  const resolution = evidence.resolution?.label ? evidence.resolution : null;
  return {
    ...derived,
    status: isBroken
      ? PatientImageStatus.BROKEN
      : derived.reviewStateSource === ReviewStateSource.RESOLUTION
        ? PatientImageStatus.ADMIN_RESOLVED
        : stateStatus[derived.reviewState],
    isAbnormal: derived.reviewState === ReviewState.ABNORMAL,
    votesCount: evidence.votes.length,
    normalVotes: count(PatientImageReviewVoteTypes.NORMAL),
    abnormalVotes: count(PatientImageReviewVoteTypes.ABNORMAL),
    uncertainVotes: count(PatientImageReviewVoteTypes.UNCERTAIN),
    adminResolutionId: resolution?.resolverId ?? null,
    adminResolutionName: resolution?.resolverName ?? null,
    resolutionComment: resolution?.comment ?? null,
    resolvedAt: resolution
      ? resolution.legacyResolvedAt ?? resolution.createdAt
      : null,
  };
};

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.()
    : a === b;

/** The cached fields whose stored value differs from the expected one. */
export const diffReviewCaches = (
  stored: Partial<Record<keyof ReviewCaches, unknown>>,
  expected: ReviewCaches
): Partial<ReviewCaches> => {
  const changes: Partial<Record<keyof ReviewCaches, unknown>> = {};
  for (const field of reviewCacheFields) {
    const value = stored[field] ?? null;
    if (!sameValue(value, expected[field])) changes[field] = expected[field];
  }
  return changes as Partial<ReviewCaches>;
};

