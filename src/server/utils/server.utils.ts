export type PortType = string | boolean | number;
import { logger } from '../../lib/services/logger.service';
import type { Server as HTTPSServer } from 'http';

const { NODE_ENV, PORT } = process.env;

export const port = parseInt(PORT || '3000', 10);

export const isDev = NODE_ENV !== 'production';

interface ExtendedError extends Error {
  code?: 'EACCES' | 'EADDRINUSE';
  syscall: 'listen' | string;
}

export const onError = (error: ExtendedError) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;
  const key = 'onError';

  // handle specific listen errors with friendly messages
  switch (error?.code) {
    case 'EACCES':
      logger.fatal(`${bind} requires elevated privileges`, key);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      logger.fatal(`${bind} is already in use`, key);
      process.exit(1);
      break;
    default:
      throw error;
  }
};

export const onListening = (server: HTTPSServer) => () => {
  const addr = server.address();
  let msg = `Listening on port ${port}`;
  if (typeof addr === 'string') {
    msg = `Listening on pipe ${addr}`;
  }
  logger.info(
    {
      url: addr instanceof Object ? `http://localhost:${port}` : undefined,
      mode: NODE_ENV,
      port,
    },
    msg
  );
};
