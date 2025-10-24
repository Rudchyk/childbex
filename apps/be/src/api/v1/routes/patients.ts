import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes } from '@libs/constants';
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
} from '@libs/schemas';
import { keycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import { Grant } from 'keycloak-connect';
import { Ctx } from '../lib/types';
import {
  getInvalidRequestError,
  getNotFoundError,
  getUnauthorizedError,
} from '../lib/helpers';
import { usePatientAssets } from '../../../services/patients.service';

const tags = [Tags.PATIENTS];

router
  .route({
    description: 'Get patients',
    method: 'GET',
    path: apiRoutes.patients,
    tags,
    ...keycloakSecurity,
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
    ...keycloakSecurity,
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
      const { name, slug, notes } = await request.json();
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
    ...keycloakSecurity,
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
    ...keycloakSecurity,
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
    description: 'Update a patient',
    method: 'PATCH',
    path: apiRoutes.patient,
    tags,
    ...keycloakSecurity,
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
  });
