import { Type, type Static } from '@sinclair/typebox';
import {
  TimestampsSchema,
  DeletedAtPropertySchema,
} from './Timestamps.schemas.js';
import { IDPropertySchema, IDSchema } from './ID.schema.js';

export const PatientCreationAttributesSchema = Type.Object({
  name: Type.String(),
  slug: Type.String(),
  notes: Type.String(),
  creatorId: IDSchema,
  creatorName: Type.String(),
});

export type PatientCreationAttributes = Static<
  typeof PatientCreationAttributesSchema
>;

export const PatientSchema = Type.Object({
  ...IDPropertySchema.properties,
  ...PatientCreationAttributesSchema.properties,
  ...TimestampsSchema.properties,
  ...DeletedAtPropertySchema.properties,
  clusters: Type.Optional(Type.Array(Type.Any())),
});

export type Patient = Static<typeof PatientSchema>;

export const PatientsSchema = Type.Array(PatientSchema);

export type Patients = Static<typeof PatientsSchema>;
