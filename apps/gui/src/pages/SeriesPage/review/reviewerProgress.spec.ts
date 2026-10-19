/**
 * Issue #44: per-reviewer Series review progress from the canonical Series
 * response only (completion records and explicit votes; no assignment
 * roster). Synthetic reviewers and images only.
 */
import {
  PatientImageReviewVoteTypes,
  type PatientSeriesResponse,
  type SeriesImage,
  type SeriesReviewCompletion,
} from '@libs/schemas';
import { progressSummary, reviewerProgress } from './reviewerProgress';

const vote = (
  reviewerId: string,
  reviewerName = `Dr ${reviewerId}`,
  updatedAt = '2026-10-01T00:00:00.000Z'
): SeriesImage['votes'][number] => ({
  id: `v-${reviewerId}-${updatedAt}`,
  patientImageId: 'x',
  reviewerId,
  reviewerName,
  vote: PatientImageReviewVoteTypes.ABNORMAL,
  comment: null,
  createdAt: updatedAt,
  updatedAt,
});

const image = (votes: SeriesImage['votes'] = []) =>
  ({ votes, implicitNormals: [] } as unknown as SeriesImage);

const completion = (
  reviewerId: string,
  overrides: Partial<SeriesReviewCompletion> = {}
): SeriesReviewCompletion => ({
  reviewerId,
  reviewerName: `Dr ${reviewerId}`,
  completedAt: '2026-10-02T10:00:00.000Z',
  imageSetRevision: 'rev',
  imageCount: 3,
  current: true,
  uncoveredImageCount: 0,
  ...overrides,
});

const data = (
  images: SeriesImage[],
  completions: SeriesReviewCompletion[] = []
): Pick<PatientSeriesResponse, 'images' | 'review'> => ({
  images,
  review: { imageSetRevision: 'rev', completions },
});

describe('reviewerProgress', () => {
  it("Doctor B sees Doctor A's current completion; B's own review stays not completed", () => {
    const progress = reviewerProgress(
      data([image([vote('b')]), image()], [completion('a')]),
      'b'
    );
    expect(
      progress.reviewers.map(({ reviewerId, isYou, status }) => ({
        reviewerId,
        isYou,
        status,
      }))
    ).toEqual([
      { reviewerId: 'b', isYou: true, status: 'notCompleted' },
      { reviewerId: 'a', isYou: false, status: 'completed' },
    ]);
    expect(progress.reviewers[1].completedAt).toBe('2026-10-02T10:00:00.000Z');
    expect(progress.youHaveNoActivity).toBe(false);
  });

  it('three reviewers: one current, one stale (uncovered images), one voter without completion', () => {
    const progress = reviewerProgress(
      data(
        [image([vote('c'), vote('b')]), image([vote('c')]), image()],
        [
          completion('a'),
          completion('b', {
            current: false,
            uncoveredImageCount: 2,
            imageSetRevision: 'old',
          }),
        ]
      ),
      'a'
    );
    const [a, b, c] = progress.reviewers;
    expect(a).toMatchObject({
      reviewerId: 'a',
      isYou: true,
      status: 'completed',
      explicitVoteCount: 0,
    });
    expect(b).toMatchObject({
      status: 'needsRecompletion',
      uncoveredImageCount: 2,
      explicitVoteCount: 1,
    });
    expect(c).toMatchObject({ status: 'notCompleted', explicitVoteCount: 2 });
    expect(c.completedAt).toBeUndefined();
    // A stale completion is not a current completion.
    expect(progress.counts).toEqual({
      completed: 1,
      needsRecompletion: 1,
      notCompleted: 1,
    });
    expect(progressSummary(progress)).toBe(
      '1 current completion · 1 needs recompletion · 1 not completed'
    );
  });

  it("uses the backend's `current`, even when no new image is uncovered (image set changed)", () => {
    const [reviewer] = reviewerProgress(
      data(
        [image()],
        [completion('a', { current: false, uncoveredImageCount: 0 })]
      ),
      undefined
    ).reviewers;
    expect(reviewer.status).toBe('needsRecompletion');
    expect(reviewer.uncoveredImageCount).toBe(0);
  });

  it('a recompletion makes the reviewer completed again', () => {
    const stale = data(
      [image()],
      [completion('a', { current: false, uncoveredImageCount: 1 })]
    );
    expect(reviewerProgress(stale, 'a').reviewers[0].status).toBe(
      'needsRecompletion'
    );
    const again = data(
      [image()],
      [completion('a', { completedAt: '2026-10-03T08:00:00.000Z' })]
    );
    expect(reviewerProgress(again, 'a').reviewers[0]).toMatchObject({
      status: 'completed',
      completedAt: '2026-10-03T08:00:00.000Z',
    });
  });

  it('a vote after completion keeps the completion and leaves other reviewers unchanged', () => {
    const before = reviewerProgress(
      data([image()], [completion('a'), completion('b')]),
      'a'
    );
    const after = reviewerProgress(
      data([image([vote('a')])], [completion('a'), completion('b')]),
      'a'
    );
    expect(after.reviewers.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
    ]);
    expect(after.reviewers[0].explicitVoteCount).toBe(1);
    expect(after.reviewers[1]).toEqual(before.reviewers[1]);
  });

  it('never infers a completion from votes alone', () => {
    const progress = reviewerProgress(
      data([image([vote('a')]), image([vote('a')])]),
      'b'
    );
    expect(progress.reviewers[0]).toMatchObject({
      status: 'notCompleted',
      explicitVoteCount: 2,
    });
    expect(progress.counts.completed).toBe(0);
  });

  it('no known reviewers', () => {
    const progress = reviewerProgress(data([image(), image()]), 'me');
    expect(progress.reviewers).toEqual([]);
    expect(progress.youHaveNoActivity).toBe(true);
    expect(progressSummary(progress)).toBe('');
  });

  it('missing names: completion name first, else the latest vote name, else none (never the id)', () => {
    const progress = reviewerProgress(
      data(
        [
          image([
            vote('a', 'Old name', '2026-10-01T00:00:00.000Z'),
            vote('x', '  '),
          ]),
          image([vote('a', 'New name', '2026-10-05T00:00:00.000Z')]),
          image([
            vote('a', '', '2026-10-06T00:00:00.000Z'),
            vote('b', 'Voter name'),
          ]),
        ],
        [
          completion('b', { reviewerName: 'Completion name' }),
          completion('c', { reviewerName: '' }),
        ]
      ),
      undefined
    );
    const names = Object.fromEntries(
      progress.reviewers.map(({ reviewerId, name }) => [reviewerId, name])
    );
    expect(names).toEqual({
      a: 'New name',
      b: 'Completion name',
      c: null,
      x: null,
    });
    // Named reviewers first, by name; unnamed last.
    expect(progress.reviewers.map(({ reviewerId }) => reviewerId)).toEqual([
      'b',
      'a',
      'c',
      'x',
    ]);
  });

  it('the signed-in user without activity is not counted as a known reviewer', () => {
    const progress = reviewerProgress(data([image([vote('a')])]), 'me');
    expect(progress.reviewers.map(({ reviewerId }) => reviewerId)).toEqual([
      'a',
    ]);
    expect(progress.youHaveNoActivity).toBe(true);
  });

  it('pluralizes the summary', () => {
    expect(
      progressSummary({
        counts: { completed: 2, needsRecompletion: 2, notCompleted: 0 },
      })
    ).toBe('2 current completions · 2 need recompletion');
  });
});
