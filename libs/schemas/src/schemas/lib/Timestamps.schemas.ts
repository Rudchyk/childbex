import { Type, type Static } from '@sinclair/typebox';
import { Nullable } from '../../utils/typebox-helpers.js';

export const CreatedAtPropertySchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
});
export type CreatedAtProperty = Static<typeof CreatedAtPropertySchema>;

export const UpdatedAtPropertySchema = Type.Object({
  updatedAt: Type.String({ format: 'date-time' }),
});
export type UpdatedAtProperty = Static<typeof UpdatedAtPropertySchema>;

export const DeletedAtPropertySchema = Type.Object({
  deletedAt: Nullable(Type.String({ format: 'date-time' })),
});
export type DeletedAtProperty = Static<typeof DeletedAtPropertySchema>;

export const TimestampsSchema = Type.Object({
  ...CreatedAtPropertySchema.properties,
  ...UpdatedAtPropertySchema.properties,
});

export type Timestamps = Static<typeof TimestampsSchema>;
