import pino from 'pino';

// const isProd = process.env.NODE_ENV === 'production';

// const prettyTransport = isProd
//   ? pino.transport({
//       target: require.resolve('pino-pretty'),
//       options: {
//         colorize: true,
//         levelFirst: true,
//       },
//     })
//   : undefined;
const prettyTransport = pino.transport({
  target: require.resolve('pino-pretty'),
  options: {
    colorize: true,
    levelFirst: true,
  },
});

export const logger = pino(
  {
    level:
      process.env.LOG_LEVEL ?? process.env.NODE_ENV === 'production'
        ? 'info'
        : 'debug',
  },
  prettyTransport
);
