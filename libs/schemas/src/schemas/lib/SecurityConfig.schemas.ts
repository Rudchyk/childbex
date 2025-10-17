import { Type, type Static } from '@sinclair/typebox';

export const SecurityConfigSchema = Type.Object({
  url: Type.String(),
  realm: Type.String(),
  clientId: Type.String(),
});

export type SecurityConfig = Static<typeof SecurityConfigSchema>;
