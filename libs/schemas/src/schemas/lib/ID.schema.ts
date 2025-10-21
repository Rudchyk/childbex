import { Type, type Static } from '@sinclair/typebox';

export const IDPropertySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});
export type IDProperty = Static<typeof IDPropertySchema>;
