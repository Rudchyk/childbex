import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.service';
import type { Server as HTTPSServer } from 'http';
import { type Error, ErrorSchema, Value } from '@libs/schemas';

const { NODE_ENV, PORT, HOST, IS_HTTPS } = process.env;

export const port = parseInt(PORT || '3000', 10);

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
    const url = `${isHttps ? 'https' : 'http'}://${
      HOST || `localhost:${port}`
    }`;
    const routesList = Object.fromEntries(
      Object.entries(routes || {}).map(([key, value]) => [key, url + value])
    );
    logger.info(
      {
        MODE: NODE_ENV,
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
  const castedError = Value.Cast(ErrorSchema, err);
  return res.status(err.status || 500).json({
    message: castedError.message,
    errors: castedError.errors,
    statusCode: castedError.status,
    expose: castedError.expose,
  });
};
