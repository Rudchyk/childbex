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
} from '@libs/schemas';
import { keycloakSecurity } from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import { logger } from '../../../services/logger.service';
import { Grant } from 'keycloak-connect';
import { Ctx } from '../lib/types';
import { getUnauthorizedError } from '../lib/helpers';

const tags = [Tags.PATIENTS];

router.route({
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
});

router.route({
  method: 'POST',
  path: apiRoutes.patients,
  tags,
  ...keycloakSecurity,
  schemas: {
    request: {
      formData: CreatePatientRequestBodySchema,
    },
    responses: {
      204: { description: 'success' },
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
    const body = await request.formData();
    const name = body.get('name');
    const slug = body.get('slug');
    const notes = body.get('notes');
    const archive = body.get('archive');
    logger.debug(
      {
        archiveName: archive?.name,
        type: archive?.type,
        size: archive?.size,
        lastModified: archive?.lastModified,
        boo: name,
      },
      'formData'
    );
    await Patient.create({
      name,
      slug,
      notes,
      creatorId: content.sub,
      creatorName:
        content.name || content.preferred_username || content.email || '',
    });
    return Response.json(null, { status: 204 });
  },
});
