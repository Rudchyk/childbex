import { Response } from 'fets';
import { router } from '../router';
import {
  NameOptionalPropertySchema,
  Type,
  defaultResponses,
} from '../schemas/schemas';
import { SecuritiesKeysEnum } from '../SecuritiesKeysEnum';
import { basicAuthValidator } from '../../../validators';

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
  security: [{ [SecuritiesKeysEnum.BASIC_AUTH]: [] }],
  validators: {
    query: basicAuthValidator,
  },
  schemas: {
    request: {
      query: { ...NameOptionalPropertySchema },
    },
    responses: {
      200: Type.String(),
      ...defaultResponses,
    },
  },
  handler: (request) => {
    const { name } = request.query;
    return Response.json(`hello: ${name}`);
  },
});
