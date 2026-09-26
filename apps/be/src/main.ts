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
import { apiDocFullRoute, apiDocRoute, apiRoute } from '@libs/constants';
import { dbSetup } from './db/sequelize';
import { uploadSessionService } from './services/upload-sessions';
import {
  isEventLoopDiagnosticsEnabled,
  startEventLoopDiagnostics,
} from './services/diagnostics/event-loop.diagnostics';

const setupServer = async () => {
  try {
    const app = express();

    // Optional (EVENT_LOOP_DIAGNOSTICS=1): logs event-loop blocking per
    // processing phase. Disabled by default.
    if (isEventLoopDiagnosticsEnabled()) {
      startEventLoopDiagnostics();
    }

    await dbSetup();
    // Recovers uploads interrupted by a restart, then cleans up periodically.
    await uploadSessionService.init();
    uploadSessionService.startCleanupTimer();

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
        api: apiDocFullRoute,
        // apiSpec: apiRoute + '/openapi.json',
      })
    );
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
};

setupServer();
