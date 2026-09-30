/**
 * Effective review state of an image and its cached fields (pure; no
 * database access). Precedence:
 *   1. an active admin resolution -> its label          (RESOLUTION)
 *   2. votes: one distinct label  -> that label          (VOTES)
 *             several labels      -> CONFLICTED          (VOTES)
 *   3. a "Finish review" completion -> NORMAL            (FINISH_REVIEW)
 *   4. otherwise                  -> NOT_REVIEWED        (NONE)
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
  votes: readonly PatientImageReviewVoteTypes[];
  /** The active resolution, if any. */
  resolution: ActiveResolution | null;
  /** A "Finish review" completion exists. */
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
 * The effective review state. Any disagreement between votes is CONFLICTED
 * (no majority); only UNCERTAIN votes are UNCERTAIN; no votes are
 * NOT_REVIEWED unless a reviewer finished the review of the cluster.
 */
export const deriveReviewState = ({
  votes,
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
  if (labels.size === 1) {
    return {
      reviewState: voteState[[...labels][0]],
      reviewStateSource: ReviewStateSource.VOTES,
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
 * `isAbnormal` (only for an ABNORMAL state), the vote counters and the
 * legacy resolution fields (from the active resolution, else null).
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

