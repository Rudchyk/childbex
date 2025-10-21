import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import {
  TimestampsSchema,
  DeletedAtPropertySchema,
} from './Timestamps.schemas.js';

export const PatientImageClusterSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  cluster: Type.Number(),
  name: Type.String(),
  patientId: Type.String({ format: 'uuid' }),
  notes: Type.Optional(Type.String()),
  studyDate: Type.Date(),
  inReview: Type.Boolean(),
  ...TimestampsSchema.properties,
  images: Type.Optional(PatientSchema),
  patient: Type.Optional(PatientSchema),
});

export type Patient = Static<typeof PatientSchema>;
