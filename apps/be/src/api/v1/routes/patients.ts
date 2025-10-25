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
  PatientsSchema,
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
} from '@libs/schemas';
import { getKeycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import { Grant } from 'keycloak-connect';
import { Ctx } from '../lib/types';
import {
  getInvalidRequestError,
  getNotFoundError,
  getUnauthorizedError,
} from '../lib/helpers';
import {
  uploadRoot,
  usePatientAssets,
} from '../../../services/patients.service';
import path from 'path';
import { rm } from 'node:fs/promises';
import { PatientImageCluster } from '../../../db/models/PatientImageCluster.model';
import { PatientImage } from '../../../db/models/PatientImage.model';
import { Op } from 'sequelize';

const tags = [Tags.PATIENTS];

router
  .route({
    description: 'Get patients',
    method: 'GET',
    path: apiRoutes.patients,
    tags,
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        query: Type.Partial(PatientCreationAttributesSchema),
      },
      responses: {
        200: PatientsSchema,
        ...unauthorizedResponse,
        ...defaultResponses,
      },
    },
    async handler(request) {
      const { query } = request;
      const isFilter = !!Object.keys(query).length;
      const result = await Patient.findAll(isFilter ? { where: query } : {});
      return Response.json(result.map((i) => i.toJSON()));
    },
  })
  .route({
    description: 'Add a patient',
    method: 'PUT',
    path: apiRoutes.patients,
    tags,
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
      const context = ctx as Ctx;
      const grant = context.req.kauth?.grant as Grant;
      const access_token = grant?.access_token;
      const content = access_token?.content;
      if (!content) {
        throw getUnauthorizedError();
      }
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
  .route({
    description: 'Update patient assets',
    method: 'POST',
    path: apiRoutes.patientUpload,
    tags,
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
      usePatientAssets(patient, archive);
      return Response.json(null, { status: 204 });
    },
  })
  .route({
    description: 'Delete a patient',
    method: 'DELETE',
    path: apiRoutes.patient,
    tags,
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
  .route({
    description: 'Get a patient',
    method: 'GET',
    path: apiRoutes.patientBySlug,
    tags,
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
            model: PatientImageCluster,
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
          [{ model: PatientImageCluster, as: 'clusters' }, 'createdAt', 'ASC'],
        ],
      });
      if (!result) {
        throw getNotFoundError('patient');
      }
      const res = result.toJSON<GetPatientResponse>();
      return Response.json(res);
    },
  })
  .route({
    description: 'Update a patient',
    method: 'PATCH',
    path: apiRoutes.patient,
    tags,
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
  .route({
    description: 'Get trashed patients',
    method: 'GET',
    path: apiRoutes.trashedPatients,
    tags,
    ...getKeycloakSecurity(['realm:admin']),
    schemas: {
      request: {
        query: Type.Partial(PatientCreationAttributesSchema),
      },
      responses: {
        200: PatientsSchema,
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
            model: PatientImageCluster,
            as: 'clusters',
          },
        ],
      });
      return Response.json(result.map((i) => i.toJSON()));
    },
  })
  .route({
    description: 'Delete or restore a patient',
    method: 'POST',
    path: apiRoutes.trashedPatient,
    tags,
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
      let destDir;

      switch (type) {
        case TrashedPatientsActionTypes.DELETE:
          destDir = path.join(uploadRoot, patient.slug);
          console.log('🚀 ~ trashedPatients ~ destDir:', destDir);
          // await access(destDir);
          await rm(destDir, {
            recursive: true,
            force: true,
            maxRetries: 3, // optional (helps on Windows)
            retryDelay: 100, // optional (ms)
          });
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
  });
