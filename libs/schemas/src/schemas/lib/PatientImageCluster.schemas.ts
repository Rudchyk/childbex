import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import { PatientImageSchema } from './PatientImage.schema.js';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { IDSchema } from './ID.schema.js';

export const PatientImageClusterSchema = Type.Object({
  id: IDSchema,
  cluster: Type.Number(),
  name: Type.String(),
  patientId: IDSchema,
  notes: Type.String(),
  studyDate: Type.Union([Type.Date(), Type.Null()]),
  inReview: Type.Boolean(),
  ...TimestampsSchema.properties,
  images: Type.Optional(Type.Array(PatientImageSchema)),
  patient: Type.Optional(PatientSchema),
});

export type PatientImageCluster = Static<typeof PatientImageClusterSchema>;
