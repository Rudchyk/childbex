import { Type, type Static } from '@sinclair/typebox';
import { TimestampsSchema } from './Timestamps.schemas.js';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';

export const PatientImageClusterSchema = Type.Object({
  id: IDSchema,
  cluster: Type.Number(),
  name: Type.String(),
  patientId: IDSchema,
  notes: Type.String(),
  studyDate: Nullable(Type.String({ format: 'date-time' })),
  inReview: Type.Boolean(),
  ...TimestampsSchema.properties,
});

export type PatientImageCluster = Static<typeof PatientImageClusterSchema>;
