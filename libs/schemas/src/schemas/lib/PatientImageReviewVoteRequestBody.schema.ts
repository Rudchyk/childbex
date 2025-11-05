import { PatientImageReviewVoteSchema } from './PatientImageReviewVote.schema.js';
import { Type, type Static } from '@sinclair/typebox';

const { comment, vote } = PatientImageReviewVoteSchema.properties;

export const PatientImageReviewVoteRequestBodySchema = Type.Object({
  comment,
  vote,
});

export type PatientImageReviewVoteRequestBody = Static<
  typeof PatientImageReviewVoteRequestBodySchema
>;
