import { Response } from 'fets';
import { router } from '../apiRouter';
import Keycloak from 'keycloak-connect';
import { apiRoutes } from '@libs/constants';
import { security } from '../../../services/security.service';
import {
  SecurityConfigSchema,
  Type,
  defaultResponses,
} from '../schemas/schemas';
import { getSecurityServiceUnavailableError } from '../lib/helpers';
import { Tags } from '../lib/tags.service';

const tags = [Tags.SECURITY];

router.route({
  method: 'GET',
  path: apiRoutes.securityConfig,
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
