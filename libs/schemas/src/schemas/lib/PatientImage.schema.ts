import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';

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

export const FinishReviewResponseSchema = Type.Object({
  runId: Type.String({ format: 'uuid' }),
  /** Images completed as NORMAL by this run. */
  completed: Type.Integer(),
  /** Images that already had votes, a resolution or a completion. */
  alreadyReviewed: Type.Integer(),
  /** Broken images (not reviewable). */
  skippedBroken: Type.Integer(),
});

export type FinishReviewResponse = Static<typeof FinishReviewResponseSchema>;

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
