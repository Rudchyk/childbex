import { Response } from 'fets';
import { router } from '../router';
import { apiRoutes } from '@libs/constants';
import {
  NameOptionalPropertySchema,
  Type,
  defaultResponses,
} from '../schemas/schemas';

router.route({
  method: 'GET',
  path: apiRoutes.hello,
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
