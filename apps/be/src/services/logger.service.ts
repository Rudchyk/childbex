import pino from 'pino';
import pretty from 'pino-pretty';

const stream =
  process.env.PRETTY_LOGS === 'true'
    ? pretty({
        colorize: true,
        levelFirst: true,
        ignore: 'pid,hostname',
      })
    : undefined;

export const logger = pino(
  {
    level:
      process.env.LOG_LEVEL ||
      (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  },
  stream
);
