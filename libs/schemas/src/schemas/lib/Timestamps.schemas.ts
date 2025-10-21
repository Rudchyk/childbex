import { Type, type Static } from '@sinclair/typebox';

export const CreatedAtPropertySchema = Type.Object({
  createdAt: Type.String(),
});
export type CreatedAtProperty = Static<typeof CreatedAtPropertySchema>;

export const UpdatedAtPropertySchema = Type.Object({
  updatedAt: Type.String(),
});
export type UpdatedAtProperty = Static<typeof UpdatedAtPropertySchema>;

export const DeletedAtPropertySchema = Type.Object({
  deletedAt: Type.String(),
});
export type DeletedAtProperty = Static<typeof DeletedAtPropertySchema>;

export const TimestampsSchema = Type.Object({
  ...CreatedAtPropertySchema.properties,
  ...UpdatedAtPropertySchema.properties,
});

export type Timestamps = Static<typeof TimestampsSchema>;
