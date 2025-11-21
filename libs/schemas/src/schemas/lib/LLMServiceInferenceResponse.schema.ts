import { Type, type Static } from '@sinclair/typebox';

export const LLMServiceInferenceResponseSchema = Type.Unknown();

export type LLMServiceInferenceResponse = Static<
  typeof LLMServiceInferenceResponseSchema
>;
