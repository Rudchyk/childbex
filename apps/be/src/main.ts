import './plugins/dotenv';

import express from 'express';
import compression from 'compression';
import morgan from 'morgan';
import {
  // errorHandler,
  onError,
  onListening,
  port,
} from './services/server.service';
import { isProd } from './constants/defaults';
import { serverRoutes, setupRoutes } from './routes/routes';
import routes from './api/v1/routes';
import { logger } from './services/logger.service';
import { libsSchemas } from '@childbex/libs-schemas';

const setupServer = async () => {
  try {
    const app = express();

    app.set('port', port);

    app.use(compression());
    app.use(morgan(isProd ? 'tiny' : 'dev'));
    app.use(express.json());

    console.log('libsSchemas', libsSchemas());

    setupRoutes(app);
    app.use(routes);

    // app.use(errorHandler);

    const server = app.listen(port);

    server.on('error', onError);
    server.on(
      'listening',
      onListening(server, { ...serverRoutes, api: '/docs' })
    );
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

setupServer();
