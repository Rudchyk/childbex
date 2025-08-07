import express, { Router, Express } from 'express';
import path from 'path';
import bodyParser from 'body-parser';
import { logger } from '../../lib/services/logger.service';

export const setupRoutes = async (app: Express) => {
  const router = Router();
  const staticPath = path.join('.', 'uploads');

  router.use('/uploads', express.static(staticPath));
  router.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  router.get(
    '/error',
    bodyParser.urlencoded({ extended: true, limit: '50mb' }),
    (req, res) => {
      try {
        logger.trace('one', 'two', 'three');
        throw new Error('Some error');
      } catch (error) {
        logger.error(error, (error as Error).message);
        return res.status(503).json(error);
      }
    }
  );
  app.use(router);
};
