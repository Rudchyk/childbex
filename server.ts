import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const port = parseInt(process.env.PORT || '3000', 10);
const isDev = process.env.NODE_ENV !== 'production';
const app = next({ dev: isDev });
const handle = app.getRequestHandler();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});

// app.prepare().then(() => {
//   server.use(cors());
//   server.use(express.json({ limit: '10mb' }));
//   server.use(express.urlencoded({ extended: true, limit: '10mb' }));
// });

app.prepare().then(() => {
  const server = express();
  server.use(
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
  server.use(cors());
  server.use(compression());
  server.use(morgan(isDev ? 'dev' : 'tiny'));
  server.use(limiter);
  server.use(
    '/uploads',
    express.static(path.join(__dirname, isDev ? '' : '..', 'uploads'))
  );
  server.get('/health', (req, res) => {
    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });
  server.use((req, res) => {
    const parsedUrl = parse(req.url!, true);
    return handle(req, res, parsedUrl);
  });
  createServer(server).listen(port);

  console.log(
    `> Server listening3 at http://localhost:${port} as ${
      isDev ? 'development' : process.env.NODE_ENV
    }`
  );
});
