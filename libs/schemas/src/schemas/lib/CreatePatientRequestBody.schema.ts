import { PatientCreationAttributesSchema } from './Patient.schemas.js';
import { Type, type Static } from '@sinclair/typebox';

const { name, slug, notes } = PatientCreationAttributesSchema.properties;

export const CreatePatientRequestBodySchema = Type.Object({
  name,
  slug: Type.Optional(slug),
  notes: Type.Optional(notes),
});

export type CreatePatientRequestBody = Static<
  typeof CreatePatientRequestBodySchema
>;
