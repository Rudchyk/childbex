import { schemas } from '@libs/schemas';
import { apiRoute, apiDocRoute } from '@libs/constants';
import { createRouter } from 'fets';

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
      schemas: {
        ...schemas,
      },
    },
  },
  swaggerUI: {
    endpoint: apiDocRoute,
  },
});
