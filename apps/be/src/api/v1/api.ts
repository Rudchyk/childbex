import type { Express } from 'express';
import { apiDocRoute, apiRoute } from '@libs/constants';
import { basicAuthValidator } from '../../validators';
import { router } from './apiRouter';
import type { KeycloakType } from '../../services/security.service';

import './routes/config';
import './routes/hello';
import { SecuritiesKeysEnum } from './lib/SecuritiesKeysEnum';

export const setupAPIRoutes = (app: Express, keycloak: KeycloakType) => {
  Object.entries(router.openAPIDocument.paths || {}).forEach(
    ([path, methods]) => {
      if (path && methods) {
        Object.values(methods).forEach((props) => {
          if (!Array.isArray(props) && 'security' in props && props.security) {
            const route = apiRoute + path;
            props.security?.forEach((securityItem) => {
              if (Array.isArray(securityItem[SecuritiesKeysEnum.KEYCLOAK])) {
                app.use(
                  route,
                  keycloak.protect(...securityItem[SecuritiesKeysEnum.KEYCLOAK])
                );
              } else if (
                Array.isArray(securityItem[SecuritiesKeysEnum.KEYCLOAK_BEARER])
              ) {
                app.use(
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
