import { Response } from 'fets';
import { router } from '../router';
import { apiRoutes } from '@libs/constants';
import { NamePropertySchema } from '@libs/schemas';

router.route({
  method: 'GET',
  path: apiRoutes.hello,
  schemas: {
    request: {
      query: NamePropertySchema,
    },
    responses: {
      200: {
        type: 'string',
      },
    },
  },
  handler(request) {
    const { name } = request.query;
    return Response.json(`hello: ${name}`);
  },
});
