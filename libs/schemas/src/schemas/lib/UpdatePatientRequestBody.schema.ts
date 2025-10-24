import { PatientCreationAttributesSchema } from './Patient.schemas.js';
import { Type, type Static } from '@sinclair/typebox';

const { name, slug, notes } = PatientCreationAttributesSchema.properties;

export const UpdatePatientRequestBodySchema = Type.Partial(
  Type.Object({
    name,
    slug,
    notes,
  })
);

export type UpdatePatientRequestBody = Static<
  typeof UpdatePatientRequestBodySchema
>;
