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

export const serverRoutes = {
  metrics: metricsRoute,
  test: '/test',
  assets: '/assets',
};

export const setupRoutes = (app: Express) => {
  const router = Router();
  logger.debug(__dirname);

  router.use(
    express.static(path.join(__dirname, process.env.GUI_DIR || '../gui'))
  );
  router.use(
    serverRoutes.assets,
    express.static(path.join(__dirname, 'assets'))
  );
  router.get(serverRoutes.test, basicAuthValidator, testController);
  router.get(serverRoutes.metrics, basicAuthValidator, metricsController);

  app.use(router);
};
