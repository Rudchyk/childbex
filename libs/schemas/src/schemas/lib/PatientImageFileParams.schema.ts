import { Type, type Static } from '@sinclair/typebox';
import { IDPropertySchema } from './ID.schema.js';

/** `id` is the patient id; both ids must be UUIDs (never file paths). */
export const PatientImageFileParamsSchema = Type.Object({
  ...IDPropertySchema.properties,
  imageId: Type.String({ format: 'uuid' }),
});

export type PatientImageFileParams = Static<
  typeof PatientImageFileParamsSchema
>;
