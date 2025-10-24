import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { PatientImageSchema } from './PatientImage.schema.js';
import { IDSchema } from './ID.schema.js';

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
  comment: Type.Optional(Type.String()),
  ...TimestampsSchema.properties,
  image: Type.Optional(PatientImageSchema),
});

export type PatientImageReviewVote = Static<
  typeof PatientImageReviewVoteSchema
>;
