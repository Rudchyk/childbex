import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes, TrashedPatientsActionTypes } from '@libs/constants';
import { Patient } from '../../../db/models/Patient.model';
import {
  Type,
  defaultResponses,
  unauthorizedResponse,
} from '../schemas/schemas';
import {
  PatientCreationAttributesSchema,
  CreatePatientRequestBodySchema,
  PatientSchema,
  IDPropertySchema,
  UpdatePatientRequestBodySchema,
  UpdatePatientRequestBody,
  SlugPropertySchema,
  GetPatientResponseSchema,
  GetPatientResponse,
  TrashedPatientsActionParamSchema,
  Value,
  GetPatientsResponseSchema,
  GetPatientsResponse,
  PatientImageReviewVoteRequestBodySchema,
  PatientImageReviewVoteRequestBody,
  PatientImageReviewVoteParamsSchema,
  PatientImageFileParamsSchema,
  ReviewResolutionRequestBodySchema,
} from '@libs/schemas';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import { Ctx } from '../lib/types';
import {
  getInternalServerRequestError,
  getInvalidRequestError,
  getNotFoundError,
  getReviewHttpError,
  getDatasetSnapshotHttpError,
  readJsonBody,
} from '../lib/helpers';
import {
  assertPatientNotInDatasetSnapshots,
  DatasetSnapshotError,
} from '../../../services/dataset-snapshot/snapshot.service';
import { getSecurityContentFromResponse } from '../lib/security.service';
import { Op } from 'sequelize';
import { uploadSessionService } from '../../../services/upload-sessions';
import { logger } from '../../../services/logger.service';
import {
  findPatientImageSource,
  openUploadFile,
} from '../../../services/patient-image-file.service';
import { countPatientImages } from '../../../services/hierarchy.service';
import {
  castVote,
  changeOwnVote,
  removeResolution,
  ReviewError,
  setResolution,
  withReviewFreezeGuard,
} from '../../../services/review.service';
import { getReviewer, runReviewAction } from '../lib/review.helpers';

/** Patients with their study and image counts (one grouped query). */
const withImageCounts = async (
  patients: Patient[]
): Promise<GetPatientsResponse> => {
  const counts = await countPatientImages(patients.map(({ id }) => id));
  return patients.map((patient) => ({
    ...patient.toJSON(),
    studyCount: counts.get(patient.id)?.studyCount ?? 0,
    imageCount: counts.get(patient.id)?.imageCount ?? 0,
  }));
};

/** The vote request body; an empty body is an invalid request. */
const readVoteBody = async (request: {
  headers: Headers;
  json(): Promise<PatientImageReviewVoteRequestBody>;
}) => {
  let body = {} as PatientImageReviewVoteRequestBody;
  const contentLength = request.headers.get('content-length');
  if (contentLength && +contentLength > 2) {
    body = await request.json();
  }
  if (
    !Object.keys(body).length ||
    !Value.Check(PatientImageReviewVoteRequestBodySchema, body)
  ) {
    throw getInvalidRequestError();
  }
  return body;
};

/**
 * Unfinished uploads of a trashed/deleted patient can never be imported;
 * remove them. Best effort: never fails the already completed deletion.
 */
const cancelUploadSessions = async (patientId: string) => {
  try {
    await uploadSessionService.cancelForPatient(patientId);
  } catch (error) {
    logger.error(
      { err: error, patientId },
      'removing upload sessions of a deleted patient failed'
    );
  }
};

/**
 * Trash (`force` false) or permanently delete a patient. Both change the
 * reviewed data (trashed patients are excluded like deleted ones), so they
 * are refused while review is frozen (409 REVIEW_FROZEN).
 */
const destroyPatient = async (patient: Patient, force: boolean) => {
  try {
    await withReviewFreezeGuard(async (transaction) => {
      // Source images of a finalized dataset snapshot are never deleted
      // (the snapshot items' FK RESTRICT is the database backstop).
      if (force) await assertPatientNotInDatasetSnapshots(patient.id, transaction);
      await patient.destroy({ force, transaction });
    });
  } catch (error) {
    if (error instanceof ReviewError) throw getReviewHttpError(error);
    if (error instanceof DatasetSnapshotError) {
      throw getDatasetSnapshotHttpError(error);
    }
    // Backstop: the snapshot items' FK RESTRICT (reached through the cascade).
    if (
      (error as { parent?: { constraint?: string } }).parent?.constraint ===
      'dataset_snapshot_items_patientImageId_fkey'
    ) {
      throw getDatasetSnapshotHttpError(
        new DatasetSnapshotError(
          'PATIENT_IN_DATASET_SNAPSHOT',
          'The patient has images in finalized dataset snapshots; it cannot be deleted permanently.'
        )
      );
    }
    logger.error({ err: error, patientId: patient.id }, 'patient delete failed');
    throw getInternalServerRequestError('Failed to delete the patient.');
  }
  await cancelUploadSessions(patient.id);
};

router
  // Get patients
  .route({
    description: 'Get patients',
    method: 'GET',
    path: apiRoutes.patients,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        query: Type.Partial(PatientCreationAttributesSchema),
      },
      responses: {
        200: GetPatientsResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { query } = request;
      const isFilter = !!Object.keys(query).length;
      const props = isFilter ? { where: query } : {};
      const result = await Patient.findAll(props);
      return Response.json(await withImageCounts(result));
    },
  })
  // Add a patient
  .route({
    description: 'Add a patient',
    method: 'POST',
    path: apiRoutes.patients,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        json: CreatePatientRequestBodySchema,
      },
      responses: {
        200: PatientSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const content = getSecurityContentFromResponse(ctx as Ctx);
      const body = await request.json();
      const isValid = Value.Check(CreatePatientRequestBodySchema, body);
      if (!isValid) {
        throw getInvalidRequestError();
      }
      const { name, slug, notes } = body;
      const result = await Patient.create({
        name,
        slug,
        notes,
        creatorId: content.sub,
        creatorName:
          content.name || content.preferred_username || content.email || '',
      });
      return Response.json(result);
    },
  })
  // Get a patient by ID
  .route({
    description: 'Get a patient by ID',
    method: 'GET',
    path: apiRoutes.patient,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
      },
      responses: {
        200: PatientSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { id } = request.params;
      const patient = await Patient.findByPk(id);
      if (!patient) {
        throw getNotFoundError('patient');
      }
      return Response.json(patient.toJSON());
    },
  })
  // Get a patient by slug
  .route({
    description: 'Get a patient by slug',
    method: 'GET',
    path: apiRoutes.patientSlug,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: SlugPropertySchema,
      },
      responses: {
        200: GetPatientResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { slug } = request.params;
      const result = await Patient.findOne({ where: { slug } });
      if (!result) {
        throw getNotFoundError('patient');
      }
      return Response.json(result.toJSON<GetPatientResponse>());
    },
  })
  // Delete a patient
  .route({
    description: 'Delete a patient',
    method: 'DELETE',
    path: apiRoutes.patient,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
      },
      responses: {
        200: PatientSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { id } = request.params;
      const patient = await Patient.findByPk(id);
      if (!patient) {
        throw getNotFoundError('patient');
      }
      await destroyPatient(patient, false);
      return Response.json(patient.toJSON());
    },
  })
  // Update a patient
  .route({
    description: 'Update a patient',
    method: 'PATCH',
    path: apiRoutes.patient,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
        json: UpdatePatientRequestBodySchema,
      },
      responses: {
        200: PatientSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { id } = request.params;
      const patient = await Patient.findByPk(id);
      if (!patient) {
        throw getNotFoundError('patient');
      }
      let body: UpdatePatientRequestBody = {};
      const contentLength = request.headers.get('content-length');
      if (contentLength && +contentLength > 2) {
        body = await request.json();
      }
      if (!Object.keys(body).length) {
        throw getInvalidRequestError();
      }
      await patient.update(body);
      return Response.json(patient.toJSON());
    },
  })
  // Get trashed patients
  .route({
    description: 'Get trashed patients',
    method: 'GET',
    path: apiRoutes.trashedPatients,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(['dashboard:admin']),
    schemas: {
      request: {
        query: Type.Partial(PatientCreationAttributesSchema),
      },
      responses: {
        200: GetPatientsResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { query } = request;
      const result = await Patient.findAll({
        paranoid: false,
        where: {
          ...query,
          deletedAt: { [Op.ne]: null },
        },
      });
      return Response.json(await withImageCounts(result));
    },
  })
  // Delete or restore a patient
  .route({
    description: 'Delete or restore a patient',
    method: 'POST',
    path: apiRoutes.trashedPatient,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(['dashboard:admin']),
    schemas: {
      request: {
        params: IDPropertySchema,
        query: TrashedPatientsActionParamSchema,
      },
      responses: {
        200: PatientSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { id } = request.params;
      const { type } = request.query;
      const patient = await Patient.findByPk(id, { paranoid: false });
      if (!patient) {
        throw getNotFoundError('patient');
      }

      switch (type) {
        case TrashedPatientsActionTypes.DELETE:
          await destroyPatient(patient, true);
          break;
        case TrashedPatientsActionTypes.RESTORE:
          // Restoring makes the patient's images active again.
          await runReviewAction(() =>
            withReviewFreezeGuard((transaction) =>
              patient.restore({ transaction })
            )
          );
          break;
        default:
          break;
      }

      return Response.json(patient.toJSON());
    },
  })
  // Get the DICOM file of a patient image
  .route({
    description:
      'Get the DICOM file of a patient image (streamed as application/dicom)',
    method: 'GET',
    path: apiRoutes.patientImageFile,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: PatientImageFileParamsSchema,
      },
      responses: {
        200: { description: 'DICOM file (application/dicom)' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { id, imageId } = request.params;
      // The same 404 for an unknown image, an image of another patient and
      // an unavailable file: the response does not reveal which one it was.
      const source = await findPatientImageSource(id, imageId);
      if (!source) {
        throw getNotFoundError('patient image');
      }
      const file = await openUploadFile(source);
      if (!file.ok) {
        // Ids only: never the stored path or the original file name.
        logger.warn(
          { patientId: id, imageId, reason: file.reason },
          'patient image file unavailable'
        );
        throw getNotFoundError('patient image');
      }
      return new Response(file.stream, {
        status: 200,
        headers: {
          'Content-Type': 'application/dicom',
          'Content-Length': String(file.size),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, no-store',
        },
      });
    },
  })
  // Cast (or change) the own review vote on an image
  .route({
    description:
      "Cast the reviewer's vote on an image, or change it (one vote per reviewer and image)",
    method: 'POST',
    path: apiRoutes.patientImagesReviewsVotes,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
        json: PatientImageReviewVoteRequestBodySchema,
      },
      responses: {
        204: { description: 'success' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { id } = request.params;
      const reviewer = getReviewer(ctx as Ctx);
      const body = await readVoteBody(request);
      await runReviewAction(() => castVote(id, reviewer, body));
      return Response.json(null, { status: 204 });
    },
  })
  // Change the own review vote
  .route({
    description:
      "Change the reviewer's own vote on this image (any other vote: 404)",
    method: 'PATCH',
    path: apiRoutes.patientImageReviewVote,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: PatientImageReviewVoteParamsSchema,
        json: PatientImageReviewVoteRequestBodySchema,
      },
      responses: {
        204: { description: 'success' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { id, voteId } = request.params;
      const reviewer = getReviewer(ctx as Ctx);
      const body = await readVoteBody(request);
      await runReviewAction(() => changeOwnVote(id, voteId, reviewer, body));
      return Response.json(null, { status: 204 });
    },
  })
  // Set the admin resolution of an image
  .route({
    description:
      'Set the admin resolution of an image (takes precedence over votes; the previous resolution is kept as history)',
    method: 'PUT',
    path: apiRoutes.patientImageReviewResolution,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(['dashboard:admin']),
    schemas: {
      request: {
        params: IDPropertySchema,
        json: ReviewResolutionRequestBodySchema,
      },
      responses: {
        204: { description: 'success' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { id } = request.params;
      const admin = getReviewer(ctx as Ctx);
      const body = await readJsonBody(request);
      if (!Value.Check(ReviewResolutionRequestBodySchema, body)) {
        throw getInvalidRequestError();
      }
      const { label, comment } = body;
      await runReviewAction(() =>
        setResolution(id, admin, { label, comment: comment ?? null })
      );
      return Response.json(null, { status: 204 });
    },
  })
  // Remove the admin resolution of an image
  .route({
    description:
      'Remove the active admin resolution of an image (kept as history; votes decide again)',
    method: 'DELETE',
    path: apiRoutes.patientImageReviewResolution,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(['dashboard:admin']),
    schemas: {
      request: {
        params: IDPropertySchema,
      },
      responses: {
        204: { description: 'success' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request, ctx) {
      const { id } = request.params;
      const admin = getReviewer(ctx as Ctx);
      await runReviewAction(() => removeResolution(id, admin));
      return Response.json(null, { status: 204 });
    },
  });
