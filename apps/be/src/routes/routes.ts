import { Router } from 'express';
import type { Express } from 'express';
import express from 'express';
import path from 'path';
import { testController } from '../controllers';
import { basicAuthValidator } from '../validators';
import {
  metricsController,
  metricsRoute,
} from '../services/prometheus.service';
import { logger } from '../services/logger.service';
import { apiRoute } from '@libs/constants';

export const serverRoutes = {
  metrics: metricsRoute,
  test: '/test',
  assets: '/assets',
  boom: '/boom',
};

export const setupRoutes = (app: Express) => {
  const router = Router();
  const clientDir = path.join(__dirname, process.env.GUI_DIR || '../gui');
  logger.debug({ clientDir });
  router.use(
    express.static(clientDir, {
      index: false,
    })
  );
  router.use(
    serverRoutes.assets,
    express.static(path.join(__dirname, 'assets'))
  );
  router.use(
    apiRoute,
    express.static(path.join(__dirname, 'html', 'oauth2-redirect'))
  );
  router.get('*', (req, res, next) => {
    // if (
    //   req.path.startsWith(apiRoute) ||
    //   req.path.startsWith(serverRoutes.assets) ||
    //   [serverRoutes.test, serverRoutes.metrics, serverRoutes.boom].includes(
    //     req.path
    //   )
    // ) {
    //   return next();
    // }
    return res.sendFile(path.join(clientDir, 'index.html'));
  });
  router.get(serverRoutes.test, basicAuthValidator, testController);
  router.get(serverRoutes.metrics, basicAuthValidator, metricsController);
  router.get(serverRoutes.boom, () => {
    throw new Error('💥BOOM💥');
  });

  app.use(router);
};
