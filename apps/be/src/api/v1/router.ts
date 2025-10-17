import { apiRoute, apiDocRoute } from '@libs/constants';
import { schemas } from './schemas/schemas';
import { createRouter, registerFormats } from 'fets';
import { SecuritiesKeysEnum } from './SecuritiesKeysEnum';

registerFormats();

export const security = [{ [SecuritiesKeysEnum.KEYCLOAK]: [] }];

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
        // [SecuritiesKeysEnum.KEYCLOAK]: {
        //   type: 'openIdConnect',
        //   openIdConnectUrl,
        //   'x-redirectUrl': 'https://localhost:8080/oauth2-redirect.html',
        // },
      },
      schemas: {
        ...schemas,
      },
    },
  },
  swaggerUI: {
    endpoint: apiDocRoute,
  },
});
