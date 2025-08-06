import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import helmet from 'helmet';
// import compression from 'compression';
import morgan from 'morgan';
// import cors from 'cors';
// import rateLimit from 'express-rate-limit';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const server = express();
const handle = app.getRequestHandler();
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 100,
//   message: 'Too many requests from this IP, please try again later.',
// });

app.prepare().then(() => {
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
  // server.use(compression());
  server.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
  // server.use(limiter);
  // server.use(cors());
  server.use(express.json({ limit: '10mb' }));
  server.use(express.urlencoded({ extended: true, limit: '10mb' }));

  server.use(
    '/uploads',
    express.static(path.join(__dirname, dev ? '' : '..', 'uploads'))
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
  const ser = createServer(server);

  ser.listen(port);

  console.log(
    `> Server listening at http://localhost:${port} as ${
      dev ? 'development' : process.env.NODE_ENV
    }`
  );
});
