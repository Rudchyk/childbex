import { Type, type Static } from '@sinclair/typebox';

export const LLMServiceCheckItemsResponseSchema = Type.Object({
  items: Type.Array(Type.String()),
});

export type LLMServiceCheckItemsResponse = Static<
  typeof LLMServiceCheckItemsResponseSchema
>;
