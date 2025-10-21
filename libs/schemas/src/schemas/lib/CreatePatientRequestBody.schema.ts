import { FromSchema } from 'fets';
import { PatientCreationAttributesSchema } from './Patient.schemas.js';

export const CreatePatientRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: PatientCreationAttributesSchema.properties.name,
    slug: PatientCreationAttributesSchema.properties.slug,
    notes: PatientCreationAttributesSchema.properties.notes,
    archive: {
      type: 'string',
      format: 'binary',
      maxLength: 1024 * 1024 * 500, // 5MB
    },
  },
} as const;

export type CreatePatientRequestBody = FromSchema<
  typeof CreatePatientRequestBodySchema
>;
