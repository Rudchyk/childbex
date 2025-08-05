import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const port = parseInt(process.env.PORT || '3000', 10);
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const server = express();
server.use(express.static(path.join(__dirname, 'uploads')));
const handle = app.getRequestHandler();

app.prepare().then(() => {
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
