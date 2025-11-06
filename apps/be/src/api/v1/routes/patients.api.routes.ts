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
  UploadPatientArchiveRequestBodySchema,
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
  UpdatePatientAssetRequestBodySchema,
  GetPatientClusterParamsSchema,
  GetPatientClusterResponseSchema,
  GetPatientClusterResponse,
  PatientImageReviewVoteRequestBodySchema,
  PatientImageReviewVoteRequestBody,
  PatientImageReviewVoteParamsSchema,
} from '@libs/schemas';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import { Ctx } from '../lib/types';
import {
  getInvalidRequestError,
  getNotFoundError,
  getInternalServerRequestError,
} from '../lib/helpers';
import { usePatientAssets } from '../../../services/patients.service';
import { PatientImagesCluster } from '../../../db/models/PatientImagesCluster.model';
import { PatientImage } from '../../../db/models/PatientImage.model';
import { getSecurityContentFromResponse } from '../lib/security.service';
import { Op } from 'sequelize';
import { PatientImageReviewVote } from '../../../db/models/PatientImageReviewVote.model';

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
      const result = await Patient.findAll({
        ...props,
        include: [
          {
            model: PatientImagesCluster,
            as: 'clusters',
          },
        ],
      });
      return Response.json(
        result.map((i) => i.toJSON()) as GetPatientsResponse
      );
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
      const result = await Patient.findOne({
        where: {
          slug,
        },
        include: [
          {
            model: PatientImagesCluster,
            as: 'clusters',
            include: [
              {
                model: PatientImage,
                as: 'images',
                attributes: ['id'],
              },
            ],
          },
        ],
        order: [
          [{ model: PatientImagesCluster, as: 'clusters' }, 'createdAt', 'ASC'],
        ],
      });
      if (!result) {
        throw getNotFoundError('patient');
      }
      const res = result.toJSON<GetPatientResponse>();
      return Response.json(res);
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
      await patient.destroy();
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
    ...getKeycloakSecurity(['realm:admin']),
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
        include: [
          {
            model: PatientImagesCluster,
            as: 'clusters',
          },
        ],
      });
      return Response.json(
        result.map((i) => i.toJSON()) as GetPatientsResponse
      );
    },
  })
  // Delete or restore a patient
  .route({
    description: 'Delete or restore a patient',
    method: 'POST',
    path: apiRoutes.trashedPatient,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(['realm:admin']),
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
          await patient.destroy({ force: true });
          break;
        case TrashedPatientsActionTypes.RESTORE:
          await patient.restore();
          break;
        default:
          break;
      }

      return Response.json(patient.toJSON());
    },
  })
  // Upload patient assets
  .route({
    description: 'Upload patient assets',
    method: 'POST',
    path: apiRoutes.patientAssetsUpload,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
        formData: UploadPatientArchiveRequestBodySchema,
      },
      responses: {
        204: { description: 'success' },
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
      const body = await request.formData();
      const archive = body.get('archive');
      try {
        await usePatientAssets(patient, archive);
      } catch (error) {
        throw getInternalServerRequestError((error as Error).message);
      }
      return Response.json(null, { status: 204 });
    },
  })
  // Update patient cluster
  .route({
    description: 'Update patient cluster',
    method: 'PATCH',
    path: apiRoutes.patientImagesCluster,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
        json: UpdatePatientAssetRequestBodySchema,
      },
      responses: {
        204: { description: 'success' },
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { id } = request.params;
      const result = await PatientImagesCluster.findByPk(id);
      if (!result) {
        throw getNotFoundError('patient images cluster');
      }
      const { inReview } = await request.json();
      if (inReview === result.inReview) {
        throw getInvalidRequestError('Nothing to update');
      }
      await result.update({ inReview });
      return Response.json(null, { status: 204 });
    },
  })
  // Delete patient cluster
  .route({
    description: 'Delete patient cluster',
    method: 'DELETE',
    path: apiRoutes.patientImagesCluster,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
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
    async handler(request) {
      const { id } = request.params;
      const result = await PatientImagesCluster.findByPk(id);
      if (!result) {
        throw getNotFoundError('cluster');
      }
      await result.destroy();
      return Response.json(null, { status: 204 });
    },
  })
  // Get patient images cluster
  .route({
    description: 'Get patient images cluster',
    method: 'GET',
    path: apiRoutes.patientSlugImagesClustersCluster,
    tags: [Tags.PATIENTS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: GetPatientClusterParamsSchema,
      },
      responses: {
        200: GetPatientClusterResponseSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { slug, cluster } = request.params;
      const result = await Patient.findOne({ where: { slug } });
      if (!result) {
        throw getNotFoundError('patient');
      }
      const imagesCluster = await PatientImagesCluster.findOne({
        where: {
          patientId: result.id,
          cluster,
        },
        include: [
          {
            model: PatientImage,
            as: 'images',
            include: [
              {
                model: PatientImageReviewVote,
                as: 'votes',
              },
            ],
          },
        ],
      });
      if (!imagesCluster) {
        throw getNotFoundError('images cluster');
      }
      return Response.json(imagesCluster.toJSON<GetPatientClusterResponse>());
    },
  })
  // Add patient image review vote
  .route({
    description: 'Add patient image review vote',
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
      const result = await PatientImage.findByPk(id);
      const content = getSecurityContentFromResponse(ctx as Ctx);
      if (!result) {
        throw getNotFoundError('patient image');
      }
      let body = {} as PatientImageReviewVoteRequestBody;
      const contentLength = request.headers.get('content-length');
      if (contentLength && +contentLength > 2) {
        body = await request.json();
      }
      if (!Object.keys(body).length) {
        throw getInvalidRequestError();
      }
      await PatientImageReviewVote.create({
        reviewerId: content.sub,
        reviewerName:
          content.name || content.preferred_username || content.email || '',
        patientImageId: id,
        ...body,
      });
      return Response.json(null, { status: 204 });
    },
  })
  // Update patient image review vote
  .route({
    description: 'Update patient image review vote',
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
    async handler(request) {
      const { id, voteId } = request.params;
      const result = await PatientImage.findByPk(id);
      if (!result) {
        throw getNotFoundError('patient image');
      }
      const patientImageReviewVote = await PatientImageReviewVote.findByPk(
        voteId
      );
      if (!patientImageReviewVote) {
        throw getNotFoundError('patient image review vote');
      }
      let body = {} as PatientImageReviewVoteRequestBody;
      const contentLength = request.headers.get('content-length');
      if (contentLength && +contentLength > 2) {
        body = await request.json();
      }
      if (!Object.keys(body).length) {
        throw getInvalidRequestError();
      }
      const update: Partial<Pick<PatientImageReviewVote, 'comment' | 'vote'>> =
        {};
      if (body.comment !== patientImageReviewVote.comment) {
        update.comment = body.comment;
      }
      if (body.vote !== patientImageReviewVote.vote) {
        update.vote = body.vote;
      }
      if (!Object.keys(update).length) {
        throw getInvalidRequestError();
      }
      await patientImageReviewVote.update(update);
      return Response.json(null, { status: 204 });
    },
  });
