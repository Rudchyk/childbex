// eslint-disable-next-line @typescript-eslint/no-require-imports
const express = require('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const next = require('next');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();

  app.get('/', (req, res) => {
    res.send({ message: 'Welcome to server!' });
  });

  // Serve /uploads as static
  // server.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Default catch-all to handle all other routes
  // server.all('*', (req, res) => {
  //   return handle(req, res);
  // });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
