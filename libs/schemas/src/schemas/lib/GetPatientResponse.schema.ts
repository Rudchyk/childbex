import { type Static } from '@sinclair/typebox';
import { PatientSchema } from './Patient.schemas.js';

/** A patient (its images are browsed by Study / Series). */
export const GetPatientResponseSchema = PatientSchema;

export type GetPatientResponse = Static<typeof GetPatientResponseSchema>;
