import { Type, type Static } from '@sinclair/typebox';
import { IDPropertySchema } from './ID.schema.js';

export const PatientImageReviewVoteParamsSchema = Type.Object({
  ...IDPropertySchema.properties,
  voteId: Type.String(),
});

export type PatientImageReviewVoteParams = Static<
  typeof PatientImageReviewVoteParamsSchema
>;
