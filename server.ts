import express from 'express';
import path from 'path';
import { createServer } from 'http';
import type { Server as HTTPSServer } from 'http';
import { parse } from 'url';
import next from 'next';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { logger } from './src/lib/services/logger.service';

const port = parseInt(process.env.PORT || '3000', 10);
const isDev = process.env.NODE_ENV !== 'production';
const app = next({ dev: isDev });
const handle = app.getRequestHandler();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

export type PortType = string | boolean | number;

interface ExtendedError extends Error {
  code?: 'EACCES' | 'EADDRINUSE';
  syscall: 'listen' | string;
}

const onError = (port: PortType) => (error: ExtendedError) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;
  const key = 'onError';

  // handle specific listen errors with friendly messages
  switch (error?.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges`, key);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use`, key);
      process.exit(1);
      break;
    default:
      throw error;
  }
};
const onListening = (server: HTTPSServer) => () => {
  const addr = server.address();

  if (addr instanceof Object) {
    const url = `http://localhost:${port}`;
    logger.info(
      `Listening on \x1b[36m${url}\x1b[0m as ${process.env.NODE_ENV}`
    );
  } else if (typeof addr === 'string') {
    logger.info(`Listening on pipe ${addr}`);
  } else {
    logger.info(`Listening on port ${port}`);
  }
};

app.prepare().then(() => {
  const expressApp = express();
  expressApp.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            'data:',
            'blob:',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'", 'ws:', 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  expressApp.use(cors());
  expressApp.use(compression());
  expressApp.use(morgan(isDev ? 'dev' : 'tiny'));
  expressApp.use(limiter);
  expressApp.use(
    express.json({
      limit: '500mb',
    })
  );
  expressApp.use(
    '/uploads',
    express.static(path.join(__dirname, isDev ? '' : '..', 'uploads'))
  );
  expressApp.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  expressApp.use((req, res) => {
    const parsedUrl = parse(req.url!, true);
    return handle(req, res, parsedUrl);
  });
  const server = createServer(expressApp).listen(port);

  server.on('error', onError(port));
  server.on('listening', onListening(server));
});
