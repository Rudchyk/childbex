import type { PatientSeriesResponse } from '@libs/schemas';

/**
 * Issue #44: each known reviewer's own Series review progress, derived only
 * from the canonical Series response. There is no reviewer-assignment
 * roster: the known reviewers are the ones with a completion record or an
 * explicit vote on an image of the Series, never a list of the doctors
 * expected to review it. Whether a completion covers the current image set
 * is the backend's `current` (image-set revision); it is not re-derived.
 * One reviewer's completion never completes or locks the Series.
 */

export type ReviewerStatus = 'completed' | 'needsRecompletion' | 'notCompleted';

export interface ReviewerProgress {
  reviewerId: string;
  /** Display name; null when neither the completion nor a vote names it. */
  name: string | null;
  /** The signed-in user's own review. */
  isYou: boolean;
  status: ReviewerStatus;
  /** The reviewer's latest completion (completed / needs recompletion). */
  completedAt?: string;
  /** Current images the latest completion does not cover (added since). */
  uncoveredImageCount?: number;
  /** Images of the Series the reviewer has an explicit vote on. */
  explicitVoteCount: number;
}

export interface SeriesReviewerProgress {
  /** Your review first, then by name (unnamed last). */
  reviewers: ReviewerProgress[];
  counts: Record<ReviewerStatus, number>;
  /** The signed-in user has neither voted on nor completed the Series. */
  youHaveNoActivity: boolean;
}

/** Shown when a reviewer's name is not available. */
export const UNNAMED_REVIEWER = 'Unnamed reviewer';

export const reviewerStatusLabels: Record<ReviewerStatus, string> = {
  completed: 'Completed',
  needsRecompletion: 'Needs recompletion',
  notCompleted: 'Not completed',
};

const nameOrNull = (name: string | null | undefined) => name?.trim() || null;

export const reviewerProgress = (
  data: Pick<PatientSeriesResponse, 'images' | 'review'>,
  currentUserId: string | undefined
): SeriesReviewerProgress => {
  const byId = new Map<string, ReviewerProgress>();
  const entry = (reviewerId: string) => {
    let item = byId.get(reviewerId);
    if (!item) {
      item = {
        reviewerId,
        name: null,
        isYou: !!currentUserId && reviewerId === currentUserId,
        status: 'notCompleted',
        explicitVoteCount: 0,
      };
      byId.set(reviewerId, item);
    }
    return item;
  };

  // The name of the latest vote, unless the completion names the reviewer.
  const voteNameAt = new Map<string, string>();
  for (const image of data.images) {
    for (const vote of image.votes) {
      const item = entry(vote.reviewerId);
      item.explicitVoteCount++;
      const name = nameOrNull(vote.reviewerName);
      if (name && vote.updatedAt >= (voteNameAt.get(vote.reviewerId) ?? '')) {
        item.name = name;
        voteNameAt.set(vote.reviewerId, vote.updatedAt);
      }
    }
  }
  for (const completion of data.review.completions) {
    const item = entry(completion.reviewerId);
    item.name = nameOrNull(completion.reviewerName) ?? item.name;
    item.status = completion.current ? 'completed' : 'needsRecompletion';
    item.completedAt = completion.completedAt;
    item.uncoveredImageCount = completion.uncoveredImageCount;
  }

  const reviewers = [...byId.values()].sort(
    (a, b) =>
      Number(b.isYou) - Number(a.isYou) ||
      Number(!a.name) - Number(!b.name) ||
      (a.name ?? '').localeCompare(b.name ?? '') ||
      a.reviewerId.localeCompare(b.reviewerId)
  );
  const counts: Record<ReviewerStatus, number> = {
    completed: 0,
    needsRecompletion: 0,
    notCompleted: 0,
  };
  for (const { status } of reviewers) counts[status]++;
  return {
    reviewers,
    counts,
    youHaveNoActivity: !!currentUserId && !byId.has(currentUserId),
  };
};

/** "1 current completion · 1 needs recompletion · 1 not completed". */
export const progressSummary = ({
  counts,
}: Pick<SeriesReviewerProgress, 'counts'>) =>
  [
    counts.completed &&
      `${counts.completed} current ${
        counts.completed === 1 ? 'completion' : 'completions'
      }`,
    counts.needsRecompletion &&
      `${counts.needsRecompletion} ${
        counts.needsRecompletion === 1 ? 'needs' : 'need'
      } recompletion`,
    counts.notCompleted && `${counts.notCompleted} not completed`,
  ]
    .filter(Boolean)
    .join(' · ');
