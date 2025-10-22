import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import { PatientImageCluster } from './PatientImageCluster.schemas.js';
import { PatientImageReviewVote } from './PatientImageReviewVote.schema.js';
import { TimestampsSchema } from './Timestamps.schemas.js';

export enum PatientImageStatus {
  NOT_REVIEWED = 'not_reviewed',
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  CONFLICTED = 'conflicted',
  ADMIN_RESOLVED = 'admin_resolved',
  BROKEN = 'broken',
}

export const PatientImageSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  source: Type.String(),
  notes: Type.Optional(Type.String()),
  clusterId: Type.String({ format: 'uuid' }),
  isBrocken: Type.Boolean(),
  isAbnormal: Type.Boolean(),
  details: Type.Object(Type.Unknown()),
  status: Type.Enum(PatientImageStatus),
  adminResolutionId: Type.Union([Type.String(), Type.Null()]),
  adminResolutionName: Type.Union([Type.String(), Type.Null()]),
  resolutionComment: Type.Union([Type.String(), Type.Null()]),
  resolvedAt: Type.Optional(Type.Null(Type.Date())),
  votesCount: Type.Number(),
  normalVotes: Type.Number(),
  abnormalVotes: Type.Number(),
  uncertainVotes: Type.Number(),
  ...TimestampsSchema.properties,
  patient: Type.Optional(PatientSchema),
});

export type PatientImage = Static<typeof PatientImageSchema> & {
  cluster?: PatientImageCluster;
  votes?: PatientImageReviewVote[];
};
