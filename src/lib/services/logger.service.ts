import pino from 'pino';
import pretty from 'pino-pretty';

const { PRETTY_LOGS, LOG_LEVEL, NODE_ENV } = process.env;
const isProd = NODE_ENV === 'production';
const isPretty = PRETTY_LOGS === 'true';
const stream = isPretty
  ? pretty({
      colorize: true,
      levelFirst: true,
      ignore: 'pid,hostname',
    })
  : undefined;

export const logger = pino(
  {
    level: LOG_LEVEL || (isProd ? 'info' : 'debug'),
  },
  stream
);
