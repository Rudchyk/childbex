import { ReviewState, ReviewStateSource, type SeriesImage } from '@libs/schemas';

/**
 * The aggregate review of an image as the slice list shows it: only the
 * canonical `reviewState` / `reviewStateSource` derived by the backend (no
 * consensus rule of its own, never `isAbnormal`). An aggregate state is the
 * reviewers' opinions (or an admin resolution), never a diagnosis.
 */

/** Names of the aggregate states ("uncertain" is shown as "Not sure"). */
export const aggregateLabels: Record<ReviewState, string> = {
  [ReviewState.ABNORMAL]: 'Abnormal',
  [ReviewState.CONFLICTED]: 'Conflicted',
  [ReviewState.UNCERTAIN]: 'Not sure',
  [ReviewState.NORMAL]: 'Normal',
  [ReviewState.NOT_REVIEWED]: 'Not reviewed',
};

const voteDetails: Record<ReviewState, string> = {
  [ReviewState.ABNORMAL]: 'flagged by reviewer vote, not a confirmed diagnosis',
  [ReviewState.CONFLICTED]: 'reviewers disagree, not resolved',
  [ReviewState.UNCERTAIN]: 'reviewers are not sure',
  [ReviewState.NORMAL]: 'by reviewer vote',
  [ReviewState.NOT_REVIEWED]: 'no reviewer opinion yet',
};

/** An admin resolution decided the state (not the reviewers' votes). */
export const isResolved = (source: ReviewStateSource) =>
  source === ReviewStateSource.RESOLUTION;

/** "All reviewers: Abnormal — flagged by reviewer vote, …" (tooltip, label). */
export const aggregateDescription = (state: ReviewState, source: ReviewStateSource) => {
  const detail = isResolved(source)
    ? 'set by an admin resolution'
    : source === ReviewStateSource.FINISH_REVIEW && state === ReviewState.NORMAL
      ? 'from completed reviews (implicit Normal)'
      : voteDetails[state];
  return `All reviewers: ${aggregateLabels[state]} — ${detail}`;
};

/** Filters of the slice list, in the order they are offered. */
export type SliceFilter = 'all' | 'abnormal' | 'conflicted' | 'uncertain';

export const sliceFilters: readonly {
  value: SliceFilter;
  label: string;
  state?: ReviewState;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'abnormal', label: 'Abnormal', state: ReviewState.ABNORMAL },
  { value: 'conflicted', label: 'Conflicted', state: ReviewState.CONFLICTED },
  { value: 'uncertain', label: 'Not sure', state: ReviewState.UNCERTAIN },
];

const filterState = Object.fromEntries(
  sliceFilters.map(({ value, state }) => [value, state])
) as Record<SliceFilter, ReviewState | undefined>;

export const matchesFilter = (state: ReviewState, filter: SliceFilter) =>
  filter === 'all' || filterState[filter] === state;

/** Images per filter (each image counts once per filter it matches). */
export const countByFilter = (
  images: readonly Pick<SeriesImage, 'reviewState'>[]
): Record<SliceFilter, number> => {
  const counts: Record<SliceFilter, number> = {
    all: 0,
    abnormal: 0,
    conflicted: 0,
    uncertain: 0,
  };
  for (const { reviewState } of images) {
    for (const { value } of sliceFilters) {
      if (matchesFilter(reviewState, value)) counts[value]++;
    }
  }
  return counts;
};
