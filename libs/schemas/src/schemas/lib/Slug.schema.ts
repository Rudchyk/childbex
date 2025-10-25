import { Type, type Static } from '@sinclair/typebox';

export const SlugSchema = Type.String({
  examples: ['test'],
});

export type Slug = Static<typeof SlugSchema>;

export const SlugPropertySchema = Type.Object({
  slug: SlugSchema,
});

export type SlugProperty = Static<typeof SlugPropertySchema>;
