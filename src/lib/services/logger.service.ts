import pino from 'pino';
import pinoHttp from 'pino-http';

const isProd = process.env.NODE_ENV === 'production';

const prettyTransport = !isProd
  ? pino.transport({
      target: require.resolve('pino-pretty'),
      options: {
        colorize: true,
        levelFirst: true,
      },
    })
  : undefined;

export const logger = pino(
  {
    level:
      process.env.LOG_LEVEL ?? process.env.NODE_ENV === 'production'
        ? 'info'
        : 'debug',
  },
  prettyTransport
);

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(res, err) {
    if ((res.statusCode && res.statusCode >= 500) || err) return 'error';
    if (res.statusCode && res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req(req) {
      return { method: req.method, url: req.url, id: req.id };
    },
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});
