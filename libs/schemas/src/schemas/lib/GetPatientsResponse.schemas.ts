import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import { PatientImageClusterSchema } from './PatientImageCluster.schemas.js';

export const GetPatientsResponseSchema = Type.Array(
  Type.Composite([
    PatientSchema,
    Type.Object({
      clusters: Type.Array(PatientImageClusterSchema),
    }),
  ])
);

export type GetPatientsResponse = Static<typeof GetPatientsResponseSchema>;
