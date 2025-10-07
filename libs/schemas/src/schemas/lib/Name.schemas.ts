import { Type, type Static } from '@sinclair/typebox';

const KEY = 'name';

export const NameSchema = Type.String();

export type Name = Static<typeof NameSchema>;

export const NamePropertySchema = Type.Object({
  [KEY]: NameSchema,
});

export type NameProperty = Static<typeof NamePropertySchema>;

export const NameOptionalPropertySchema = Type.Object({
  [KEY]: Type.Optional(NameSchema),
});

export type NameOptionalProperty = Static<typeof NameOptionalPropertySchema>;
