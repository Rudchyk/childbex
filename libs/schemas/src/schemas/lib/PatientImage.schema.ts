import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';
import { PatientImageReviewVoteTypes } from './PatientImageReviewVote.schema.js';

/**
 * Legacy status (a compatibility cache of the review state; order matches
 * the database enum). Ground truth is `reviewState` / `reviewStateSource`.
 */
export enum PatientImageStatus {
  NOT_REVIEWED = 'not_reviewed',
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  CONFLICTED = 'conflicted',
  ADMIN_RESOLVED = 'admin_resolved',
  BROKEN = 'broken',
  UNCERTAIN = 'uncertain',
}

/** Effective review state of an image. */
export enum ReviewState {
  NOT_REVIEWED = 'NOT_REVIEWED',
  NORMAL = 'NORMAL',
  ABNORMAL = 'ABNORMAL',
  UNCERTAIN = 'UNCERTAIN',
  CONFLICTED = 'CONFLICTED',
}

/** Why an image has its review state. */
export enum ReviewStateSource {
  NONE = 'NONE',
  VOTES = 'VOTES',
  RESOLUTION = 'RESOLUTION',
  FINISH_REVIEW = 'FINISH_REVIEW',
}

/** Labels of an explicit admin resolution. */
export enum ReviewResolutionLabel {
  NORMAL = 'NORMAL',
  ABNORMAL = 'ABNORMAL',
  UNCERTAIN = 'UNCERTAIN',
}

export const PatientImageSchema = Type.Object({
  id: IDSchema,
  source: Type.String(),
  notes: Type.Optional(Type.String()),
  isBrocken: Type.Boolean(),
  isAbnormal: Type.Boolean(),
  status: Type.Enum(PatientImageStatus),
  adminResolutionId: Nullable(Type.String()),
  adminResolutionName: Nullable(Type.String()),
  resolutionComment: Nullable(Type.String()),
  resolvedAt: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
  votesCount: Type.Number(),
  normalVotes: Type.Number(),
  abnormalVotes: Type.Number(),
  uncertainVotes: Type.Number(),
  /** Effective review state (ground truth; optional for older clients). */
  reviewState: Type.Optional(Type.Enum(ReviewState)),
  reviewStateSource: Type.Optional(Type.Enum(ReviewStateSource)),
  ...TimestampsSchema.properties,
});

export type PatientImage = Static<typeof PatientImageSchema>;

export const ReviewResolutionRequestBodySchema = Type.Object(
  {
    label: Type.Enum(ReviewResolutionLabel),
    comment: Type.Optional(Nullable(Type.String({ maxLength: 255 }))),
  },
  { additionalProperties: false }
);

export type ReviewResolutionRequestBody = Static<
  typeof ReviewResolutionRequestBodySchema
>;

/**
 * A reviewer's "Complete review" of a Series: every presented image the
 * reviewer did not vote on is the reviewer's implicit NORMAL (no vote rows).
 */
export const CompleteSeriesReviewResponseSchema = Type.Object({
  completionId: Type.String({ format: 'uuid' }),
  completedAt: Type.String({ format: 'date-time' }),
  /** Revision of the completed image set (SHA-256 of the sorted image ids). */
  imageSetRevision: Type.String(),
  /** Non-broken images covered by the completion. */
  imageCount: Type.Integer(),
  /** The reviewer's explicit votes among them. */
  explicitAbnormal: Type.Integer(),
  explicitUncertain: Type.Integer(),
  explicitNormal: Type.Integer(),
  /** Images without an explicit vote of the reviewer: implicit NORMAL. */
  implicitNormal: Type.Integer(),
  /** Broken images (not reviewable, not covered). */
  skippedBroken: Type.Integer(),
});

export type CompleteSeriesReviewResponse = Static<
  typeof CompleteSeriesReviewResponseSchema
>;

/** The most images one bulk vote may change. */
export const MAX_BULK_REVIEW_VOTE_IMAGES = 5000;

export const BulkReviewVoteRequestBodySchema = Type.Object(
  {
    /** Image ids of the Series (all must be non-broken images of it). */
    imageIds: Type.Array(IDSchema, {
      minItems: 1,
      maxItems: MAX_BULK_REVIEW_VOTE_IMAGES,
    }),
    vote: Type.Enum(PatientImageReviewVoteTypes),
  },
  { additionalProperties: false }
);

export type BulkReviewVoteRequestBody = Static<
  typeof BulkReviewVoteRequestBodySchema
>;

/** All or nothing: counts of the reviewer's own votes. */
export const BulkReviewVoteResponseSchema = Type.Object({
  /** Distinct images in the request. */
  requested: Type.Integer(),
  /** New votes. */
  created: Type.Integer(),
  /** Existing votes of the reviewer with another value, changed. */
  changed: Type.Integer(),
  /** Existing votes of the reviewer with the same value. */
  unchanged: Type.Integer(),
});

export type BulkReviewVoteResponse = Static<typeof BulkReviewVoteResponseSchema>;

export const ReviewFreezeRequestBodySchema = Type.Object(
  { reason: Type.String({ minLength: 1, maxLength: 1000 }) },
  { additionalProperties: false }
);

export type ReviewFreezeRequestBody = Static<
  typeof ReviewFreezeRequestBodySchema
>;

export const ReviewFreezeStateSchema = Type.Object({
  frozen: Type.Boolean(),
  reason: Nullable(Type.String()),
  frozenAt: Nullable(Type.String({ format: 'date-time' })),
  frozenByName: Nullable(Type.String()),
});

export type ReviewFreezeState = Static<typeof ReviewFreezeStateSchema>;
