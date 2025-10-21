import { Response } from 'fets';
import { router } from '../apiRouter';
import { apiRoutes } from '@libs/constants';
import { Patient } from '../../../db/models/Patient.model';
import {
  Type,
  defaultResponses,
  unauthorizedResponse,
} from '../schemas/schemas';
import { SecuritiesKeysEnum } from '../lib/SecuritiesKeysEnum';
import { PatientCreationAttributesSchema, PatientsSchema } from '@libs/schemas';

const tags = ['Data'];

router.route({
  method: 'GET',
  path: apiRoutes.patients,
  tags,
  security: [
    {
      [SecuritiesKeysEnum.KEYCLOAK]: [],
      [SecuritiesKeysEnum.KEYCLOAK_BEARER]: [],
    },
  ],
  schemas: {
    request: {
      query: Type.Optional(PatientCreationAttributesSchema),
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
