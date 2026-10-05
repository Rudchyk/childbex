/** Effective review state and its cached fields (pure derivation). */
import {
  PatientImageReviewVoteTypes as Vote,
  PatientImageStatus,
  ReviewResolutionLabel,
  ReviewState,
  ReviewStateSource,
} from '@libs/schemas';
import {
  deriveReviewCaches,
  deriveReviewState,
  diffReviewCaches,
  type ActiveResolution,
} from './review-state';

const resolution = (
  label: ReviewResolutionLabel | null,
  extra: Partial<ActiveResolution> = {}
): ActiveResolution => ({
  label,
  resolverId: 'admin-1',
  resolverName: 'Admin',
  comment: 'checked',
  legacyResolvedAt: null,
  createdAt: new Date('2026-09-30T10:00:00Z'),
  ...extra,
});

const state = (
  votes: Vote[],
  options: { resolution?: ActiveResolution | null; completed?: boolean } = {}
) =>
  deriveReviewState({
    votes,
    resolution: options.resolution ?? null,
    completed: options.completed ?? false,
  });

describe('deriveReviewState', () => {
  it('zero votes, no resolution, no completion -> NOT_REVIEWED / NONE', () => {
    expect(state([])).toEqual({
      reviewState: ReviewState.NOT_REVIEWED,
      reviewStateSource: ReviewStateSource.NONE,
    });
  });

  it.each([
    [[Vote.NORMAL], ReviewState.NORMAL],
    [[Vote.NORMAL, Vote.NORMAL, Vote.NORMAL], ReviewState.NORMAL],
    [[Vote.ABNORMAL, Vote.ABNORMAL], ReviewState.ABNORMAL],
    [[Vote.UNCERTAIN], ReviewState.UNCERTAIN],
    [[Vote.UNCERTAIN, Vote.UNCERTAIN], ReviewState.UNCERTAIN],
  ])('unanimous votes %j -> %s (VOTES)', (votes, expected) => {
    expect(state(votes)).toEqual({
      reviewState: expected,
      reviewStateSource: ReviewStateSource.VOTES,
    });
  });

  it.each([
    [[Vote.NORMAL, Vote.ABNORMAL]],
    // A large majority does not hide the disagreement.
    [[Vote.NORMAL, Vote.NORMAL, Vote.NORMAL, Vote.NORMAL, Vote.ABNORMAL]],
    [[Vote.ABNORMAL, Vote.ABNORMAL, Vote.ABNORMAL, Vote.NORMAL]],
    [[Vote.NORMAL, Vote.UNCERTAIN]],
    [[Vote.ABNORMAL, Vote.UNCERTAIN, Vote.UNCERTAIN]],
  ])('any disagreement %j -> CONFLICTED (VOTES)', (votes) => {
    expect(state(votes)).toEqual({
      reviewState: ReviewState.CONFLICTED,
      reviewStateSource: ReviewStateSource.VOTES,
    });
  });

  it('a completion without votes -> NORMAL / FINISH_REVIEW', () => {
    expect(state([], { completed: true })).toEqual({
      reviewState: ReviewState.NORMAL,
      reviewStateSource: ReviewStateSource.FINISH_REVIEW,
    });
  });

  it('a later vote overrides the completion', () => {
    expect(state([Vote.ABNORMAL], { completed: true })).toEqual({
      reviewState: ReviewState.ABNORMAL,
      reviewStateSource: ReviewStateSource.VOTES,
    });
  });

  it('an active resolution overrides votes and completion', () => {
    expect(
      state([Vote.NORMAL, Vote.ABNORMAL], {
        resolution: resolution(ReviewResolutionLabel.UNCERTAIN),
        completed: true,
      })
    ).toEqual({
      reviewState: ReviewState.UNCERTAIN,
      reviewStateSource: ReviewStateSource.RESOLUTION,
    });
  });

  describe('implicit NORMAL (completed Series reviews)', () => {
    const implicit = (votes: Vote[], implicitNormals: number) =>
      deriveReviewState({ votes, implicitNormals, resolution: null, completed: false });

    it('only implicit NORMALs -> NORMAL / FINISH_REVIEW', () => {
      expect(implicit([], 2)).toEqual({
        reviewState: ReviewState.NORMAL,
        reviewStateSource: ReviewStateSource.FINISH_REVIEW,
      });
    });

    it('agrees with explicit NORMAL votes -> NORMAL / VOTES', () => {
      expect(implicit([Vote.NORMAL], 1)).toEqual({
        reviewState: ReviewState.NORMAL,
        reviewStateSource: ReviewStateSource.VOTES,
      });
    });

    it.each([[Vote.ABNORMAL], [Vote.UNCERTAIN]])(
      'disagrees with another reviewer\'s explicit %s -> CONFLICTED',
      (vote) => {
        expect(implicit([vote], 1)).toEqual({
          reviewState: ReviewState.CONFLICTED,
          reviewStateSource: ReviewStateSource.VOTES,
        });
      }
    );

    it('is not a vote: counters count explicit votes only; isAbnormal is not agreement', () => {
      const caches = deriveReviewCaches(
        { votes: [Vote.ABNORMAL], implicitNormals: 1, resolution: null, completed: false },
        false
      );
      expect(caches).toMatchObject({
        reviewState: ReviewState.CONFLICTED,
        isAbnormal: false,
        votesCount: 1,
        normalVotes: 0,
        abnormalVotes: 1,
      });
    });

    it('a resolution still takes precedence', () => {
      expect(
        deriveReviewState({
          votes: [],
          implicitNormals: 3,
          resolution: resolution(ReviewResolutionLabel.ABNORMAL),
          completed: false,
        })
      ).toEqual({
        reviewState: ReviewState.ABNORMAL,
        reviewStateSource: ReviewStateSource.RESOLUTION,
      });
    });
  });

  it('an unlabelled (set-aside legacy) resolution never decides', () => {
    expect(state([Vote.NORMAL], { resolution: resolution(null) })).toEqual({
      reviewState: ReviewState.NORMAL,
      reviewStateSource: ReviewStateSource.VOTES,
    });
  });
});

describe('deriveReviewCaches', () => {
  it('fills the compatibility caches from the effective state', () => {
    expect(
      deriveReviewCaches(
        {
          votes: [Vote.ABNORMAL, Vote.ABNORMAL],
          resolution: null,
          completed: false,
        },
        false
      )
    ).toEqual({
      reviewState: ReviewState.ABNORMAL,
      reviewStateSource: ReviewStateSource.VOTES,
      status: PatientImageStatus.ABNORMAL,
      isAbnormal: true,
      votesCount: 2,
      normalVotes: 0,
      abnormalVotes: 2,
      uncertainVotes: 0,
      adminResolutionId: null,
      adminResolutionName: null,
      resolutionComment: null,
      resolvedAt: null,
    });
  });

  it('isAbnormal only for an ABNORMAL state (never for CONFLICTED)', () => {
    const caches = deriveReviewCaches(
      { votes: [Vote.ABNORMAL, Vote.NORMAL], resolution: null, completed: false },
      false
    );
    expect(caches).toMatchObject({
      reviewState: ReviewState.CONFLICTED,
      status: PatientImageStatus.CONFLICTED,
      isAbnormal: false,
    });
  });

  it('uncertain-only has its own status', () => {
    expect(
      deriveReviewCaches(
        { votes: [Vote.UNCERTAIN], resolution: null, completed: false },
        false
      ).status
    ).toBe(PatientImageStatus.UNCERTAIN);
  });

  it('a resolution: admin_resolved status with its label and resolver fields', () => {
    const active = resolution(ReviewResolutionLabel.ABNORMAL);
    expect(
      deriveReviewCaches(
        { votes: [Vote.NORMAL], resolution: active, completed: false },
        false
      )
    ).toMatchObject({
      reviewState: ReviewState.ABNORMAL,
      reviewStateSource: ReviewStateSource.RESOLUTION,
      status: PatientImageStatus.ADMIN_RESOLVED,
      isAbnormal: true,
      normalVotes: 1,
      adminResolutionId: 'admin-1',
      adminResolutionName: 'Admin',
      resolutionComment: 'checked',
      resolvedAt: active.createdAt,
    });
  });

  it('a confirmed legacy resolution keeps its historical time and (missing) resolver', () => {
    const legacyTime = new Date('2025-01-02T03:04:05Z');
    expect(
      deriveReviewCaches(
        {
          votes: [],
          resolution: resolution(ReviewResolutionLabel.NORMAL, {
            resolverId: null,
            resolverName: 'Old admin',
            comment: null,
            legacyResolvedAt: legacyTime,
          }),
          completed: false,
        },
        false
      )
    ).toMatchObject({
      adminResolutionId: null,
      adminResolutionName: 'Old admin',
      resolutionComment: null,
      resolvedAt: legacyTime,
    });
  });

  it('a broken image keeps the broken status', () => {
    expect(
      deriveReviewCaches({ votes: [], resolution: null, completed: false }, true)
    ).toMatchObject({
      reviewState: ReviewState.NOT_REVIEWED,
      status: PatientImageStatus.BROKEN,
    });
  });
});

describe('diffReviewCaches', () => {
  const expected = deriveReviewCaches(
    { votes: [], resolution: resolution(ReviewResolutionLabel.NORMAL), completed: false },
    false
  );

  it('is empty when the stored caches match (dates by value)', () => {
    expect(
      diffReviewCaches(
        { ...expected, resolvedAt: new Date(expected.resolvedAt as Date) },
        expected
      )
    ).toEqual({});
  });

  it('lists every field that differs (NULL review state included)', () => {
    expect(
      diffReviewCaches(
        {
          ...expected,
          reviewState: null,
          reviewStateSource: null,
          status: PatientImageStatus.NORMAL,
          votesCount: 3,
          resolvedAt: null,
        },
        expected
      )
    ).toEqual({
      reviewState: ReviewState.NORMAL,
      reviewStateSource: ReviewStateSource.RESOLUTION,
      status: PatientImageStatus.ADMIN_RESOLVED,
      votesCount: 0,
      resolvedAt: expected.resolvedAt,
    });
  });
});
