import { Type, type Static } from '@sinclair/typebox';

export const LLMServiceInferenceRequestBodySchema = Type.Object({
  model: Type.Optional(Type.String()),
});

export type LLMServiceInferenceRequestBody = Static<
  typeof LLMServiceInferenceRequestBodySchema
>;
