import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes } from '@libs/constants';
import {
  BulkReviewVoteRequestBodySchema,
  BulkReviewVoteResponseSchema,
  CompleteSeriesReviewRequestBodySchema,
  CompleteSeriesReviewResponseSchema,
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
import { getAuthorizedReviewer, runReviewAction } from '../lib/review.helpers';
import {
  getPatientSeries,
  getPatientStudies,
  getStudySeries,
} from '../../../services/hierarchy.service';
import {
  castBulkVote,
  completeSeriesReview,
} from '../../../services/review.service';

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
  // Complete the current reviewer's review of a series
  .route({
    description:
      "Complete the current reviewer's review of a Series: records the reviewer, time and the presented image set (revision); every presented image without the reviewer's vote is the reviewer's implicit NORMAL (no vote rows). Not a lock: votes can change later. Only for a single-orientation Series without multi-frame images (409 SERIES_NOT_FULLY_REVIEWABLE), only when presentedImageIds are exactly its non-broken images (409 SERIES_CHANGED); 409 REVIEW_LOCKED while a dataset snapshot is captured (retry).",
    method: 'POST',
    path: apiRoutes.patientSeriesCompleteReview,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: PatientSeriesParamsSchema,
        json: CompleteSeriesReviewRequestBodySchema,
      },
      responses: {
        200: CompleteSeriesReviewResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { patientId, seriesId } = request.params;
      const reviewer = getAuthorizedReviewer(ctx as Ctx);
      const body = await readJsonBody(request);
      if (!Value.Check(CompleteSeriesReviewRequestBodySchema, body)) {
        throw getInvalidRequestError();
      }
      return Response.json(
        await runReviewAction(() =>
          completeSeriesReview(patientId, seriesId, reviewer, body.presentedImageIds)
        )
      );
    },
  })
  // The current reviewer's vote on many images of a series
  .route({
    description:
      "Set the current reviewer's own vote on many images of a Series in one transaction (all or nothing; other reviewers' votes are untouched; repeating is a no-op). Every id must be a non-broken image of this Series of this patient (400 IMAGES_NOT_IN_SERIES / IMAGES_NOT_REVIEWABLE / INVALID_IMAGE_IDS); 404 for another patient's or an unknown Series; 409 REVIEW_LOCKED while a dataset snapshot is captured (retry), 409 REVIEW_FROZEN while frozen.",
    method: 'POST',
    path: apiRoutes.patientSeriesReviewVotes,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: PatientSeriesParamsSchema,
        json: BulkReviewVoteRequestBodySchema,
      },
      responses: {
        200: BulkReviewVoteResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { patientId, seriesId } = request.params;
      const reviewer = getAuthorizedReviewer(ctx as Ctx);
      const body = await readJsonBody(request);
      if (!Value.Check(BulkReviewVoteRequestBodySchema, body)) {
        throw getInvalidRequestError();
      }
      return Response.json(
        await runReviewAction(() =>
          castBulkVote(patientId, seriesId, reviewer, body.imageIds, body.vote)
        )
      );
    },
  });
