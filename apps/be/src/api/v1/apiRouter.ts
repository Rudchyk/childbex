import { apiRoute, apiDocRoute } from '@libs/constants';
import { schemas } from './schemas/schemas';
import { createRouter, registerFormats } from 'fets';
import { SecuritiesKeysEnum } from './lib/SecuritiesKeysEnum';
import { BasicAuthenticationPlugin } from './plugins/BasicAuthenticationPlugin';
import { securityIssuer } from '../../services/security.service';

registerFormats();

export const router = createRouter({
  landingPage: false,
  base: apiRoute,
  openAPI: {
    openapi: '3.1.0',
    info: {
      title: 'API title',
      description: 'API description',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        [SecuritiesKeysEnum.BASIC_AUTH]: {
          type: 'http',
          scheme: 'basic',
          description: 'Basic Authentication',
        },
        [SecuritiesKeysEnum.KEYCLOAK_BEARER]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Supply an access token from Keycloak in Authorization: Bearer <token>',
        },
        [SecuritiesKeysEnum.KEYCLOAK]: {
          type: 'openIdConnect',
          openIdConnectUrl: `${securityIssuer}/.well-known/openid-configuration`,
        },
      },
      schemas: {
        ...schemas,
      },
    },
  },
  swaggerUI: {
    endpoint: apiDocRoute,
    displayOperationId: false,
    // oauth2RedirectUrl: '/oauth2-redirect/oauth2-redirect.html',
  },
  plugins: [BasicAuthenticationPlugin],
});
