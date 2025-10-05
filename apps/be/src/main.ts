import express from 'express';
import path from 'path';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = express();

app.use(express.static(path.join(__dirname, '..', 'gui')));
const path2 = path.join(__dirname, 'assets');
app.use('/assets', express.static(path2));
app.get('/api/hello', (req, res) => {
  res.send({ message: 'Hello API' });
});

app.listen(port, host, () => {
  console.log(`[ ready ] http://${host}:${port}`);
});
