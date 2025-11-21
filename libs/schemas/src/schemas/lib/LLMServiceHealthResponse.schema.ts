import { Type, type Static } from '@sinclair/typebox';

export const LLMServiceHealthResponseSchema = Type.Object({
  status: Type.String(),
  timestamp: Type.String(),
  uptime: Type.Number(),
});

export type LLMServiceHealthResponse = Static<
  typeof LLMServiceHealthResponseSchema
>;
