import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import { PatientImageClusterSchema } from './PatientImageCluster.schemas.js';
import { PatientImageReviewVoteSchema } from './PatientImageReviewVote.schema.js';
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
  resolutionComment: Type.Union([Type.String(), Type.Null()]),
  // resolvedAt: Type.Optional(Type.Null(Type.Date())),
  // votesCount: Type.Boolean(),
  // normalVotes: Type.Boolean(),
  // abnormalVotes: Type.Boolean(),
  // uncertainVotes: Type.Boolean(),
  // ...TimestampsSchema.properties,
  // cluster: Type.Optional(PatientImageClusterSchema),
  // patient: Type.Optional(PatientSchema),
  // votes: Type.Optional(Type.Array(PatientImageReviewVoteSchema)),
});

export type PatientImage = Static<typeof PatientSchema>;
