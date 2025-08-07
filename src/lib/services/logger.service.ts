import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, levelFirst: true },
  },
  level:
    process.env.LOG_LEVEL ?? process.env.NODE_ENV === 'production'
      ? 'info'
      : 'debug',
});

export default logger;
