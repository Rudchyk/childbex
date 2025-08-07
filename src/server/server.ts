import './plugins/dotenv';
import express from 'express';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { isDev, onError, onListening, port } from './utils/server.utils';
import { setupRoutes } from './routes/routes';

const app = next({ dev: isDev });
const handle = app.getRequestHandler();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

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
  setupRoutes(expressApp);
  expressApp.use((req, res) => {
    const parsedUrl = parse(req.url!, true);
    return handle(req, res, parsedUrl);
  });
  const server = createServer(expressApp).listen(port);

  server.on('error', onError);
  server.on('listening', onListening(server));
});
