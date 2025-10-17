import { Response, HTTPError } from 'fets';
import { router } from '../router';
import Keycloak from 'keycloak-connect';
import { apiRoutes } from '@libs/constants';
import { security } from '../../../services/security.service';
import {
  SecurityConfigSchema,
  Type,
  defaultResponses,
} from '../schemas/schemas';

const tags = ['Security'];

const getSecurityServiceUnavailableError = () =>
  new HTTPError(
    503,
    'Service Unavailable',
    {},
    {
      message: 'Security service is not initialized',
    }
  );

router.route({
  method: 'GET',
  path: apiRoutes.security,
  tags,
  schemas: {
    responses: {
      200: SecurityConfigSchema,
      ...defaultResponses,
    },
  },
  handler() {
    const config = security?.getConfig();
    if (!config) {
      throw getSecurityServiceUnavailableError();
    }
    return Response.json({
      url: config['auth-server-url'],
      realm: config.realm,
      clientId: config.resource,
    });
  },
});

router.route({
  method: 'GET',
  path: apiRoutes.securityVerify,
  tags,
  schemas: {
    request: {
      query: Type.Object({
        token: Type.String(),
      }),
    },
    responses: {
      200: Type.Boolean(),
      ...defaultResponses,
    },
  },
  handler: async (request) => {
    if (!security) {
      throw getSecurityServiceUnavailableError();
    }
    const result = await security?.verifyToken(
      request.query.token as unknown as Keycloak.Token
    );
    return Response.json(result);
  },
});
