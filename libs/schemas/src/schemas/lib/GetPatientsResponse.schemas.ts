import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import { PatientImagesClusterSchema } from './PatientImagesCluster.schemas.js';

export const GetPatientsResponseSchema = Type.Array(
  Type.Composite([
    PatientSchema,
    Type.Object({
      clusters: Type.Array(PatientImagesClusterSchema),
    }),
  ])
);

export type GetPatientsResponse = Static<typeof GetPatientsResponseSchema>;
