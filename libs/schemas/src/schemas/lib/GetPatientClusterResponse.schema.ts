import { Type, type Static } from '@sinclair/typebox';
import { PatientImagesClusterSchema } from './PatientImagesCluster.schemas.js';
import { PatientImageReviewVoteSchema } from './PatientImageReviewVote.schema.js';
import { PatientImageSchema } from './PatientImage.schema.js';

export const GetPatientClusterResponseSchema = Type.Composite([
  Type.Composite([
    PatientImagesClusterSchema,
    Type.Object({
      images: Type.Array(
        Type.Composite([
          PatientImageSchema,
          Type.Object({
            votes: Type.Array(PatientImageReviewVoteSchema),
          }),
        ])
      ),
    }),
  ]),
]);

export type GetPatientClusterResponse = Static<
  typeof GetPatientClusterResponseSchema
>;
