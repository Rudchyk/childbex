import { Response } from 'fets';
import { router } from '../apiRouter';
import {
  NameOptionalPropertySchema,
  Type,
  defaultResponses,
  unauthorizedResponse,
} from '../schemas/schemas';
import { SecuritiesKeysEnum } from '../lib/SecuritiesKeysEnum';

const tags = ['Development'];

router.route({
  method: 'GET',
  path: '/hello',
  tags,
  schemas: {
    request: {
      query: { ...NameOptionalPropertySchema },
    },
    responses: {
      200: Type.String(),
      ...defaultResponses,
    },
  },
  handler(request) {
    const { name } = request.query;
    return Response.json(`hello: ${name}`);
  },
});

router.route({
  method: 'GET',
  path: '/basic-hello',
  tags,
  security: [
    {
      [SecuritiesKeysEnum.BASIC_AUTH]: {},
    },
  ],
  schemas: {
    request: {
      query: { ...NameOptionalPropertySchema },
    },
    responses: {
      200: Type.String(),
      ...unauthorizedResponse,
      ...defaultResponses,
    },
  },
  handler: (request) => {
    const { name } = request.query;
    return Response.json(`hello: ${name} 1111`);
  },
});

router.route({
  method: 'GET',
  path: '/basic-hello2',
  tags,
  security: [
    {
      [SecuritiesKeysEnum.KEYCLOAK]: {},
      [SecuritiesKeysEnum.KEYCLOAK_BEARER]: {},
    },
  ],
  schemas: {
    request: {
      query: { ...NameOptionalPropertySchema },
    },
    responses: {
      200: Type.String(),
      ...unauthorizedResponse,
      ...defaultResponses,
    },
  },
  handler: (request) => {
    const { name } = request.query;
    return Response.json(`hello: ${name} 2222`);
  },
});
