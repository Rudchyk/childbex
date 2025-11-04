import { Type, type Static } from '@sinclair/typebox';
import { SlugPropertySchema } from './Slug.schema.js';

export const GetPatientClusterParamsSchema = Type.Object({
  ...SlugPropertySchema.properties,
  cluster: Type.String(),
});

export type GetPatientClusterParams = Static<
  typeof GetPatientClusterParamsSchema
>;
