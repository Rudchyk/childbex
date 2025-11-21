import { Type, type Static } from '@sinclair/typebox';

export const LLMServiceCheckItemsRequestBodySchema = Type.Array(Type.String());

export type LLMServiceCheckItemsRequestBody = Static<
  typeof LLMServiceCheckItemsRequestBodySchema
>;
