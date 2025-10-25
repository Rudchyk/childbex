import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';

export enum PatientImageReviewVoteTypes {
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  UNCERTAIN = 'uncertain',
}

export const PatientImageReviewVoteSchema = Type.Object({
  id: IDSchema,
  patientImageId: IDSchema,
  reviewerId: Type.String(),
  reviewerName: Type.String(),
  vote: Type.Enum(PatientImageReviewVoteTypes),
  comment: Nullable(Type.String()),
  ...TimestampsSchema.properties,
});

export type PatientImageReviewVote = Static<
  typeof PatientImageReviewVoteSchema
>;
