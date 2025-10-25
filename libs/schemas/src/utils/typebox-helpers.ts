import { Static, TSchema, Type } from '@sinclair/typebox';

export const Nullable = <T extends TSchema>(T: T) => {
  return Type.Union([T, Type.Null()]);
};

export const LegacyRef = <T extends TSchema>(schema: T) =>
  Type.Unsafe<Static<T>>(Type.Ref(schema.$id!));
