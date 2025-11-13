import type { Express } from 'express';
import { apiDocRoute, apiRoute } from '@libs/constants';
import { basicAuthValidator } from '../../validators';
import { router } from './apiRouter';
import type { KeycloakType } from '../../services/security.service';
import { SecuritiesKeysEnum } from './lib/SecuritiesKeysEnum';

import './routes/config.api.routes';
import './routes/hello';
import './routes/patients.api.routes';

export const setupAPIRoutes = (app: Express, keycloak: KeycloakType) => {
  Object.entries(router.openAPIDocument.paths || {}).forEach(
    ([path, methods]) => {
      if (path && methods) {
        Object.entries(methods).forEach(([key, props]) => {
          if (!Array.isArray(props) && 'security' in props && props.security) {
            const route = apiRoute + path;
            const method = key.toLowerCase() as
              | 'get'
              | 'post'
              | 'put'
              | 'delete'
              | 'patch';

            props.security?.forEach((securityItem) => {
              if (Array.isArray(securityItem[SecuritiesKeysEnum.KEYCLOAK])) {
                app[method](
                  route,
                  keycloak.protect(...securityItem[SecuritiesKeysEnum.KEYCLOAK])
                );
              } else if (
                Array.isArray(securityItem[SecuritiesKeysEnum.KEYCLOAK_BEARER])
              ) {
                app[method](
                  route,
                  keycloak.protect(
                    ...securityItem[SecuritiesKeysEnum.KEYCLOAK_BEARER]
                  )
                );
              }
            });
          }
        });
      }
    }
  );

  app.use(apiRoute + apiDocRoute, basicAuthValidator);
  app.use(router);
};
