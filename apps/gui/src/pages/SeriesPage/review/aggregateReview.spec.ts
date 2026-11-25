/**
 * Issue #43: the slice list shows the canonical aggregate review state of
 * all reviewers (backend `reviewState` / `reviewStateSource`), never a
 * consensus of its own and never as a diagnosis.
 */
import { ReviewState, ReviewStateSource } from '@libs/schemas';
import {
  aggregateDescription,
  countByFilter,
  isResolved,
  matchesFilter,
} from './aggregateReview';

describe('aggregateDescription', () => {
  it.each([
    [ReviewState.ABNORMAL, ReviewStateSource.VOTES,
      'All reviewers: Abnormal — flagged by reviewer vote, not a confirmed diagnosis'],
    [ReviewState.CONFLICTED, ReviewStateSource.VOTES,
      'All reviewers: Conflicted — reviewers disagree, not resolved'],
    [ReviewState.UNCERTAIN, ReviewStateSource.VOTES, 'All reviewers: Not sure — reviewers are not sure'],
    [ReviewState.NORMAL, ReviewStateSource.VOTES, 'All reviewers: Normal — by reviewer vote'],
    [ReviewState.NORMAL, ReviewStateSource.FINISH_REVIEW,
      'All reviewers: Normal — from completed reviews (implicit Normal)'],
    [ReviewState.NOT_REVIEWED, ReviewStateSource.NONE,
      'All reviewers: Not reviewed — no reviewer opinion yet'],
    [ReviewState.ABNORMAL, ReviewStateSource.RESOLUTION,
      'All reviewers: Abnormal — set by an admin resolution'],
    [ReviewState.NORMAL, ReviewStateSource.RESOLUTION, 'All reviewers: Normal — set by an admin resolution'],
    [ReviewState.UNCERTAIN, ReviewStateSource.RESOLUTION,
      'All reviewers: Not sure — set by an admin resolution'],
  ])('%s (%s)', (state, source, expected) => {
    expect(aggregateDescription(state, source)).toBe(expected);
  });

  it('only an admin resolution counts as resolved', () => {
    expect(isResolved(ReviewStateSource.RESOLUTION)).toBe(true);
    for (const source of [ReviewStateSource.VOTES, ReviewStateSource.FINISH_REVIEW, ReviewStateSource.NONE]) {
      expect(isResolved(source)).toBe(false);
    }
  });
});

describe('filters and counts', () => {
  it('each filter matches exactly its canonical state; All matches every state', () => {
    for (const state of Object.values(ReviewState)) {
      expect(matchesFilter(state, 'all')).toBe(true);
      expect(matchesFilter(state, 'abnormal')).toBe(state === ReviewState.ABNORMAL);
      expect(matchesFilter(state, 'conflicted')).toBe(state === ReviewState.CONFLICTED);
      expect(matchesFilter(state, 'uncertain')).toBe(state === ReviewState.UNCERTAIN);
    }
  });

  it('counts by canonical state (a conflict is never counted as Abnormal or Normal)', () => {
    const states = [
      ReviewState.ABNORMAL,
      ReviewState.ABNORMAL,
      ReviewState.CONFLICTED,
      ReviewState.UNCERTAIN,
      ReviewState.NORMAL,
      ReviewState.NOT_REVIEWED,
    ];
    expect(countByFilter(states.map((reviewState) => ({ reviewState })))).toEqual({
      all: 6,
      abnormal: 2,
      conflicted: 1,
      uncertain: 1,
    });
    expect(countByFilter([])).toEqual({ all: 0, abnormal: 0, conflicted: 0, uncertain: 0 });
  });
});
