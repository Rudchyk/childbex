import { schemas } from '@libs/schemas';
import { createRouter } from 'fets';

export const router = createRouter({
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
    // endpoint: false,
  },
});
