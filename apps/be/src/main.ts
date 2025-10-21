import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import {
  errorHandler,
  onError,
  onListening,
  port,
} from './services/server.service';
import { isProd } from './constants/defaults';
import { serverRoutes, setupRoutes } from './routes/routes';
import { setupAPIRoutes } from './api/v1/api';
import { logger } from './services/logger.service';
import { setupSecurity } from './services/security.service';
import { apiDocRoute, apiRoute } from '@libs/constants';
import { dbSetup } from './db/sequelize';

const setupServer = async () => {
  try {
    const app = express();

    await dbSetup();

    app.set('port', port);

    app.use(compression());
    app.use(morgan(isProd ? 'tiny' : 'dev'));
    app.use(express.json());

    const security = setupSecurity(app);
    setupRoutes(app);
    setupAPIRoutes(app, security.keycloak);

    app.use(errorHandler);

    const server = app.listen(port);

    server.on('error', onError);
    server.on(
      'listening',
      onListening(server, {
        ...serverRoutes,
        api: apiRoute + apiDocRoute,
        // apiSpec: apiRoute + '/openapi.json',
      })
    );
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

setupServer();
