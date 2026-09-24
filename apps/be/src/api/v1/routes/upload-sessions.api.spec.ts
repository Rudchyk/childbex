/**
 * End-to-end test of the chunked upload API over real HTTP (Express + fets),
 * with a fake Keycloak (user taken from a test header) and a mocked import.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type * as ApiModule from '../api';
import type * as UploadSessionsModule from '../../../services/upload-sessions';

const mockImported: Buffer[] = [];

jest.mock('../../../services/logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

jest.mock('../../../services/patients.service', () => ({
  ...jest.requireActual('../../../services/patients.service'),
  importPatientArchiveFile: jest.fn(
    async ({ archivePath }: { archivePath: string }) => {
       
      const fs = require('node:fs/promises');
      mockImported.push(await fs.readFile(archivePath));
      return {
        importedImages: 2,
        alreadyImported: 0,
        clusters: 1,
        brokenImages: 0,
        skippedFiles: 0,
      };
    }
  ),
}));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const MiB = 1024 * 1024;

let sessionsDir: string;
let server: Server;
let baseUrl: string;
let sessions: typeof UploadSessionsModule;

const fakeKeycloak = {
  protect:
    () =>
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      const user = req.header('x-test-user');
      if (!user) {
        res.status(401).json({ message: 'unauthenticated' });
        return;
      }
      (req as unknown as { kauth: unknown }).kauth = {
        grant: { access_token: { content: { sub: user } } },
      };
      next();
    },
};

beforeAll(async () => {
  sessionsDir = await mkdtemp(path.join(os.tmpdir(), 'childbex-api-sessions-'));
  process.env.UPLOAD_SESSIONS_DIR = sessionsDir;
  process.env.UPLOAD_CHUNK_SIZE_BYTES = String(8 * MiB);

   
  const { setupAPIRoutes } = require('../api') as typeof ApiModule;
  sessions = require('../../../services/upload-sessions');
  const { Patient } = require('../../../db/models/Patient.model');
   
  jest
    .spyOn(Patient, 'findByPk')
    .mockImplementation(async (id: unknown) =>
      id === PATIENT ? { id: PATIENT } : null
    );
  await sessions.uploadSessionService.init();

  const app = express();
  app.use(express.json());
  setupAPIRoutes(app, fakeKeycloak as never);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await sessions.uploadSessionService.whenIdle();
  await new Promise((resolve) => server.close(resolve));
  await rm(sessionsDir, { recursive: true, force: true });
  delete process.env.UPLOAD_SESSIONS_DIR;
  delete process.env.UPLOAD_CHUNK_SIZE_BYTES;
});

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

const call = (
  method: string,
  url: string,
  init: {
    user?: string | null;
    json?: unknown;
    body?: Buffer;
    headers?: Record<string, string>;
  } = {}
) =>
  fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(init.user === null ? {} : { 'x-test-user': init.user ?? 'user-a' }),
      ...(init.json ? { 'content-type': 'application/json' } : {}),
      ...(init.body ? { 'content-type': 'application/octet-stream' } : {}),
      ...init.headers,
    },
    body: init.json
      ? JSON.stringify(init.json)
      : init.body && new Uint8Array(init.body),
  });

const putChunk = (
  uploadId: string,
  index: number,
  data: Buffer,
  totalChunks: number,
  user?: string
) =>
  call('PUT', `/upload-sessions/${uploadId}/chunks/${index}`, {
    user,
    body: data,
    headers: {
      'x-chunk-count': String(totalChunks),
      'x-chunk-sha256': sha(data),
    },
  });

const waitForStatus = async (uploadId: string, done: string[]) => {
  for (let i = 0; i < 200; i++) {
    const body = await (
      await call('GET', `/upload-sessions/${uploadId}`)
    ).json();
    if (done.includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for the upload session');
};

describe('chunked upload API', () => {
  // Two chunks with an 8 MiB chunk size.
  const file = randomBytes(8 * MiB + 1234);
  const chunks = [file.subarray(0, 8 * MiB), file.subarray(8 * MiB)];

  it('uploads out of order, resumes, assembles and imports the archive', async () => {
    const created = await call('POST', `/patients/${PATIENT}/upload-sessions`, {
      json: { fileName: 'Some Patient Name.tar.gz', fileSize: file.length },
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session).toMatchObject({ totalChunks: 2, chunkSize: 8 * MiB });

    expect((await putChunk(session.uploadId, 1, chunks[1], 2)).status).toBe(
      201
    );

    // Resume: the client asks what is missing.
    const status = await (
      await call('GET', `/upload-sessions/${session.uploadId}`)
    ).json();
    expect(status).toMatchObject({ receivedChunks: [1], missingChunks: [0] });

    expect((await putChunk(session.uploadId, 0, chunks[0], 2)).status).toBe(
      201
    );
    // Duplicate request (e.g. a retry after a lost response).
    expect((await putChunk(session.uploadId, 0, chunks[0], 2)).status).toBe(
      200
    );

    const completed = await call(
      'POST',
      `/upload-sessions/${session.uploadId}/complete`
    );
    expect(completed.status).toBe(202);
    const final = await waitForStatus(session.uploadId, [
      'completed',
      'failed',
    ]);
    expect(final).toMatchObject({
      status: 'completed',
      result: { importedImages: 2 },
    });
    expect(mockImported).toHaveLength(1);
    expect(mockImported[0].equals(file)).toBe(true);
  });

  it('rejects a chunk whose checksum does not match, without exposing server paths', async () => {
    const { uploadId } = await (
      await call('POST', `/patients/${PATIENT}/upload-sessions`, {
        json: { fileName: 'study.zip', fileSize: 100 },
      })
    ).json();
    const response = await call(
      'PUT',
      `/upload-sessions/${uploadId}/chunks/0`,
      {
        body: Buffer.alloc(100, 1),
        headers: {
          'x-chunk-count': '1',
          'x-chunk-sha256': sha(Buffer.alloc(100, 2)),
        },
      }
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'CHUNK_CHECKSUM_MISMATCH' });
    expect(JSON.stringify(body)).not.toContain(sessionsDir);
    expect(
      await readFile(path.join(sessionsDir, uploadId, 'session.json'), 'utf8')
    ).not.toContain('"0"');
  });

  it("hides other users' sessions and requires authentication", async () => {
    const { uploadId } = await (
      await call('POST', `/patients/${PATIENT}/upload-sessions`, {
        json: { fileName: 'study.zip', fileSize: 100 },
      })
    ).json();
    expect(
      (await call('GET', `/upload-sessions/${uploadId}`, { user: 'user-b' }))
        .status
    ).toBe(404);
    expect(
      (await putChunk(uploadId, 0, Buffer.alloc(100), 1, 'user-b')).status
    ).toBe(404);
    expect(
      (await call('GET', `/upload-sessions/${uploadId}`, { user: null })).status
    ).toBe(401);
  });

  it('rejects unsupported archives and unknown patients before any upload', async () => {
    const rar = await call('POST', `/patients/${PATIENT}/upload-sessions`, {
      json: { fileName: 'study.rar', fileSize: 100 },
    });
    expect(rar.status).toBe(400);
    expect(await rar.json()).toMatchObject({ code: 'UNSUPPORTED_FORMAT' });

    const tooLarge = await call(
      'POST',
      `/patients/${PATIENT}/upload-sessions`,
      {
        json: { fileName: 'study.zip', fileSize: 500 * MiB + 1 },
      }
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ code: 'UPLOAD_TOO_LARGE' });

    const invalid = await call('POST', `/patients/${PATIENT}/upload-sessions`, {
      json: { fileSize: 100 },
    });
    expect(invalid.status).toBe(400);

    const unknown = await call(
      'POST',
      '/patients/22222222-2222-4222-8222-222222222222/upload-sessions',
      { json: { fileName: 'study.zip', fileSize: 100 } }
    );
    expect(unknown.status).toBe(404);
  });
});
