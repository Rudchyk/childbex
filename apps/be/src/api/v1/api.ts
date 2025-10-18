import type { Express } from 'express';
import { apiDocRoute, apiRoute } from '@libs/constants';
import { Request, Response, NextFunction } from 'express';
import { basicAuthValidator } from '../../validators';
import { router } from './apiRouter';
import { security, KeycloakType } from '../../services/security.service';

import './routes/config';
import './routes/hello';

export const setupAPIRoutes = (app: Express, keycloak: KeycloakType) => {
  // app.use(apiRoute, (req: Request, res: Response, next: NextFunction) => {
  //   return keycloak.protect();
  // });
  app.use(apiRoute + apiDocRoute, basicAuthValidator);
  const boo = router.openAPIDocument;
  app.use(router);
};
