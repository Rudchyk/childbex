import { Type, type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';

export const GetPatientsResponseSchema = Type.Array(
  Type.Composite([
    PatientSchema,
    Type.Object({
      /** DICOM Studies of the patient. */
      studyCount: Type.Integer(),
      /** Images in them (broken included). */
      imageCount: Type.Integer(),
    }),
  ])
);

export type GetPatientsResponse = Static<typeof GetPatientsResponseSchema>;
