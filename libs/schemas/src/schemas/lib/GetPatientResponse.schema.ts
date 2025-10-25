import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';
import { PatientImageClusterSchema } from './PatientImageCluster.schemas.js';
import { PatientImageSchema } from './PatientImage.schema.js';

export const GetPatientResponseSchema = Type.Composite([
  PatientSchema,
  Type.Object({
    clusters: Type.Array(
      Type.Composite([
        PatientImageClusterSchema,
        Type.Object({
          images: Type.Array(PatientImageSchema),
        }),
      ])
    ),
  }),
]);

export type GetPatientResponse = Static<typeof GetPatientResponseSchema>;
