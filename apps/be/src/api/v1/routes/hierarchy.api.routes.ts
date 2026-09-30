import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes } from '@libs/constants';
import {
  FinishReviewResponseSchema,
  FinishSeriesReviewRequestBodySchema,
  PatientSeriesParamsSchema,
  PatientSeriesResponseSchema,
  PatientStudiesParamsSchema,
  PatientStudiesResponseSchema,
  PatientStudyParamsSchema,
  StudySeriesResponseSchema,
  Value,
} from '@libs/schemas';
import { defaultResponses, unauthorizedResponse } from '../schemas/schemas';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import type { Ctx } from '../lib/types';
import {
  getInvalidRequestError,
  getNotFoundError,
  readJsonBody,
} from '../lib/helpers';
import { getReviewer, runReviewAction } from '../lib/review.helpers';
import {
  getPatientSeries,
  getPatientStudies,
  getStudySeries,
} from '../../../services/hierarchy.service';
import { finishSeriesReview } from '../../../services/review.service';

const tags = [Tags.PATIENTS];

router
  // Studies of a patient
  .route({
    description:
      'DICOM Studies of a patient with review summaries, and the count of images not linked to a Series',
    method: 'GET',
    path: apiRoutes.patientStudies,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: PatientStudiesParamsSchema },
      responses: {
        200: PatientStudiesResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { patientId } = request.params;
      const result = await getPatientStudies(patientId);
      if (!result) throw getNotFoundError('patient');
      return Response.json(result);
    },
  })
  // Series of a study
  .route({
    description: 'DICOM Series of a Study of the patient, with review summaries',
    method: 'GET',
    path: apiRoutes.patientStudySeries,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: PatientStudyParamsSchema },
      responses: {
        200: StudySeriesResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { patientId, studyId } = request.params;
      const result = await getStudySeries(patientId, studyId);
      // The same 404 for an unknown study and a study of another patient.
      if (!result) throw getNotFoundError('study');
      return Response.json(result);
    },
  })
  // A series with its images
  .route({
    description:
      'A DICOM Series of the patient with its images in display order (files through the authenticated file route)',
    method: 'GET',
    path: apiRoutes.patientSeries,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: PatientSeriesParamsSchema },
      responses: {
        200: PatientSeriesResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { patientId, seriesId } = request.params;
      const result = await getPatientSeries(patientId, seriesId);
      if (!result) throw getNotFoundError('series');
      return Response.json(result);
    },
  })
  // Finish the review of a series
  .route({
    description:
      'Finish the review of a Series: its untouched images are completed as NORMAL (FINISH_REVIEW). Only for a single-orientation Series without multi-frame images (409 SERIES_NOT_FULLY_REVIEWABLE), and only when presentedImageIds are exactly its non-broken images (409 SERIES_CHANGED).',
    method: 'POST',
    path: apiRoutes.patientSeriesFinishReview,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: PatientSeriesParamsSchema,
        json: FinishSeriesReviewRequestBodySchema,
      },
      responses: {
        200: FinishReviewResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { patientId, seriesId } = request.params;
      const reviewer = getReviewer(ctx as Ctx);
      const body = await readJsonBody(request);
      if (!Value.Check(FinishSeriesReviewRequestBodySchema, body)) {
        throw getInvalidRequestError();
      }
      return Response.json(
        await runReviewAction(() =>
          finishSeriesReview(patientId, seriesId, reviewer, body.presentedImageIds)
        )
      );
    },
  });
