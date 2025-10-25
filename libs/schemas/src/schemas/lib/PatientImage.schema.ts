import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';

export enum PatientImageStatus {
  NOT_REVIEWED = 'not_reviewed',
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  CONFLICTED = 'conflicted',
  ADMIN_RESOLVED = 'admin_resolved',
  BROKEN = 'broken',
}

export const PatientImageSchema = Type.Object({
  id: IDSchema,
  source: Type.String(),
  notes: Type.Optional(Type.String()),
  clusterId: IDSchema,
  isBrocken: Type.Boolean(),
  isAbnormal: Type.Boolean(),
  details: Nullable(Type.Object({})),
  status: Type.Enum(PatientImageStatus),
  adminResolutionId: Nullable(Type.String()),
  adminResolutionName: Nullable(Type.String()),
  resolutionComment: Nullable(Type.String()),
  resolvedAt: Type.Optional(Nullable(Type.String({ format: 'date-time' }))),
  votesCount: Type.Number(),
  normalVotes: Type.Number(),
  abnormalVotes: Type.Number(),
  uncertainVotes: Type.Number(),
  ...TimestampsSchema.properties,
});

export type PatientImage = Static<typeof PatientImageSchema>;
