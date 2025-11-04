import { PatientImagesClusterSchema } from './PatientImagesCluster.schemas.js';
import { Type, type Static } from '@sinclair/typebox';

const { inReview } = PatientImagesClusterSchema.properties;

export const UpdatePatientAssetRequestBodySchema = Type.Object({ inReview });

export type UpdatePatientAssetRequestBody = Static<
  typeof UpdatePatientAssetRequestBodySchema
>;
