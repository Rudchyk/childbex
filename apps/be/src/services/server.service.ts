import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.service';
import type { Server as HTTPSServer } from 'http';
import type { Error } from '@libs/schemas';

const { NODE_ENV, PORT, HOST, IS_HTTPS } = process.env;

export const port = parseInt(PORT || '3000', 10);

export const host = HOST ?? 'localhost';

export const isHttps = IS_HTTPS === 'true';

export interface ExtendedError extends Error {
  code?: 'EACCES' | 'EADDRINUSE';
  syscall: 'listen' | string;
}

export const onError = (error: ExtendedError) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error?.code) {
    case 'EACCES':
      logger.fatal(`${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.fatal(`${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
};

export const onListening =
  (server: HTTPSServer, routes?: Record<string, string>) => () => {
    const addr = server.address();
    let msg = `Listening on port ${port}`;
    if (typeof addr === 'string') {
      msg = `Listening on pipe ${addr}`;
    }
    const url = `${isHttps ? 'https' : 'http'}://${host}:${port}`;
    const routesList = Object.fromEntries(
      Object.entries(routes || {}).map(([key, value]) => [key, url + value])
    );
    logger.info(
      {
        MODE: NODE_ENV,
        PORT,
        url: addr instanceof Object ? url : undefined,
        ...routesList,
      },
      msg
    );
  };

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error(err, 'Global ERROR');
  return res.status(err.status || 500).json({
    message: err.message,
    errors: err.errors,
    statusCode: err.status,
    expose: err.expose,
  });
};
