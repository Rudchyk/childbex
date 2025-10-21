import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { PatientImageSchema } from './PatientImage.schema.js';

export enum PatientImageReviewVoteTypes {
  NORMAL = 'normal',
  ABNORMAL = 'abnormal',
  UNCERTAIN = 'uncertain',
}

export const PatientImageReviewVoteSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  patientImageId: Type.String({ format: 'uuid' }),
  reviewerId: Type.String({ format: 'uuid' }),
  reviewerName: Type.String(),
  vote: Type.Enum(PatientImageReviewVoteTypes),
  comment: Type.Optional(Type.String()),
  ...TimestampsSchema.properties,
  image: Type.Optional(PatientImageSchema),
});

export type PatientImageReviewVote = Static<
  typeof PatientImageReviewVoteSchema
>;
