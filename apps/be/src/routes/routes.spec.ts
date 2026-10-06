import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type * as RoutesModule from './routes';

jest.mock('../services/logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const CLUSTER = '33333333-3333-4333-8333-333333333333';
const content = Buffer.from('DICM synthetic image bytes');
const INDEX_HTML = '<!doctype html><html><head><base href="/"></head><body>spa</body></html>';
const WORKER_JS = 'self.onmessage = () => undefined; // synthetic worker';

let tmp: string;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-static-'));
  const uploadRoot = path.join(tmp, 'uploads');
  process.env.UPLOAD_ROOT = uploadRoot;
  const folder = path.join(uploadRoot, PATIENT, CLUSTER);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'image.dcm'), content);
  // A built GUI with the dwv decoder workers (vite static copy).
  const guiDir = path.join(tmp, 'gui');
  await mkdir(path.join(guiDir, 'assets', 'workers'), { recursive: true });
  await writeFile(path.join(guiDir, 'index.html'), INDEX_HTML);
  await writeFile(path.join(guiDir, 'assets', 'workers', 'rle.worker.min.js'), WORKER_JS);
  process.env.GUI_DIR = path.relative(__dirname, guiDir);

  const { setupRoutes } = require('./routes') as typeof RoutesModule;
  const app = express();
  setupRoutes(app);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(tmp, { recursive: true, force: true });
  delete process.env.UPLOAD_ROOT;
  delete process.env.GUI_DIR;
});

describe('dwv decoder workers', () => {
  it('are served as JavaScript at /assets/workers/ (compressed transfer syntaxes)', async () => {
    const response = await fetch(`${baseUrl}/assets/workers/rle.worker.min.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/javascript/);
    expect(await response.text()).toBe(WORKER_JS);
  });

  it('a missing worker is a 404, never the SPA index.html', async () => {
    const response = await fetch(`${baseUrl}/assets/workers/jpeg2000.worker.min.js`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('spa');
  });

  it('deep SPA routes still get index.html (whose <base href="/"> resolves the workers)', async () => {
    const response = await fetch(`${baseUrl}/patients/p/studies/s/series/x`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX_HTML);
  });
});

describe('/uploads', () => {
  it.each([
    `/uploads/${PATIENT}/${CLUSTER}/image.dcm`,
    `/uploads/${PATIENT}/${CLUSTER}/`,
    '/uploads/',
  ])('no longer serves stored files (%s)', async (url) => {
    const response = await fetch(`${baseUrl}${url}`);
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(404);
    // Neither the file nor the SPA index.html fallback.
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    expect(body.includes(content)).toBe(false);
  });
});
