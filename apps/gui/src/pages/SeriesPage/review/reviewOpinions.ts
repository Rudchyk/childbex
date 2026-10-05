import {
  PatientImageReviewVoteTypes,
  type PatientSeriesResponse,
  type SeriesImage,
  type SeriesReviewCompletion,
} from '@libs/schemas';

/** Labels the radiologists use ("uncertain" is shown as "Not sure"). */
export const opinionLabels: Record<PatientImageReviewVoteTypes, string> = {
  [PatientImageReviewVoteTypes.NORMAL]: 'Normal',
  [PatientImageReviewVoteTypes.ABNORMAL]: 'Abnormal',
  [PatientImageReviewVoteTypes.UNCERTAIN]: 'Not sure',
};

/** The bulk actions, in the order they are offered. */
export const bulkVoteOrder = [
  PatientImageReviewVoteTypes.NORMAL,
  PatientImageReviewVoteTypes.ABNORMAL,
  PatientImageReviewVoteTypes.UNCERTAIN,
] as const;

/**
 * A reviewer's opinion on an image: their explicit vote, else an implicit
 * NORMAL when their latest completed review of the Series covers it.
 */
export type ReviewerOpinion =
  | { vote: PatientImageReviewVoteTypes; source: 'explicit' }
  | { vote: PatientImageReviewVoteTypes.NORMAL; source: 'implicit'; completedAt: string };

export const opinionOf = (
  image: Pick<SeriesImage, 'votes' | 'implicitNormals'>,
  reviewerId: string | undefined
): ReviewerOpinion | null => {
  if (!reviewerId) return null;
  const vote = image.votes.find((item) => item.reviewerId === reviewerId);
  if (vote) return { vote: vote.vote, source: 'explicit' };
  const implicit = image.implicitNormals.find((item) => item.reviewerId === reviewerId);
  return implicit
    ? {
        vote: PatientImageReviewVoteTypes.NORMAL,
        source: 'implicit',
        completedAt: implicit.completedAt,
      }
    : null;
};

/** The reviewer's latest completion of the Series, if any. */
export const completionOf = (
  data: Pick<PatientSeriesResponse, 'review'>,
  reviewerId: string | undefined
): SeriesReviewCompletion | undefined =>
  reviewerId
    ? data.review.completions.find((item) => item.reviewerId === reviewerId)
    : undefined;

/** The reviewer's explicit votes among images, and the images without one. */
export const countOwnVotes = (
  images: readonly Pick<SeriesImage, 'votes'>[],
  reviewerId: string | undefined
) => {
  const counts = { abnormal: 0, uncertain: 0, normal: 0, unmarked: 0 };
  for (const image of images) {
    const vote = image.votes.find((item) => item.reviewerId === reviewerId)?.vote;
    if (vote === PatientImageReviewVoteTypes.ABNORMAL) counts.abnormal++;
    else if (vote === PatientImageReviewVoteTypes.UNCERTAIN) counts.uncertain++;
    else if (vote === PatientImageReviewVoteTypes.NORMAL) counts.normal++;
    else counts.unmarked++;
  }
  return counts;
};
