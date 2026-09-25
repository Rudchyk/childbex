/**
 * Patient trash/delete over real HTTP with a fake Keycloak. The patient row
 * is mocked; the real post-delete hook and upload session store are used.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type * as ApiModule from '../api';
import type * as PatientModel from '../../../db/models/Patient.model';
import type * as UploadSessionsModule from '../../../services/upload-sessions';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
};
jest.mock('../../../services/logger.service', () => ({ logger: mockLogger }));

const PATIENT = '11111111-1111-4111-8111-111111111111';

let tmp: string;
let server: Server;
let baseUrl: string;
let Patient: typeof PatientModel.Patient;
let sessions: typeof UploadSessionsModule.uploadSessionService;
let destroyImpl: (options: { force?: boolean }) => Promise<void>;

const fakeKeycloak = {
  protect:
    () =>
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      (req as unknown as { kauth: unknown }).kauth = {
        grant: { access_token: { content: { sub: 'user-a' } } },
      };
      next();
    },
};

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-patient-delete-'));
  process.env.UPLOAD_ROOT = path.join(tmp, 'uploads');
  process.env.UPLOAD_SESSIONS_DIR = path.join(tmp, 'sessions');
   
  const { setupAPIRoutes } = require('../api') as typeof ApiModule;
  ({ Patient } = require('../../../db/models/Patient.model'));
  ({
    uploadSessionService: sessions,
  } = require('../../../services/upload-sessions'));
   
  await sessions.init();

  jest.spyOn(Patient, 'findByPk').mockImplementation((async (id: unknown) => ({
    id,
    destroy: (options: { force?: boolean } = {}) => destroyImpl(options),
    restore: async () => undefined,
    toJSON: () => ({ id }),
  })) as never);

  const app = express();
  app.use(express.json());
  setupAPIRoutes(app, fakeKeycloak as never);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(tmp, { recursive: true, force: true });
  delete process.env.UPLOAD_ROOT;
  delete process.env.UPLOAD_SESSIONS_DIR;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Behaves like Sequelize: the row is deleted, then afterDestroy runs.
  destroyImpl = (options) =>
    (
      Patient as unknown as {
        runHooks(name: string, ...args: unknown[]): Promise<void>;
      }
    ).runHooks('afterDestroy', Patient.build({ id: PATIENT } as never), {
      force: !!options.force,
    });
});

const pendingSession = () =>
  sessions.create({
    patientId: PATIENT,
    ownerSub: 'user-a',
    fileName: 'study.zip',
    fileSize: 100,
  });

describe('patient delete', () => {
  it('permanent delete succeeds without an upload directory and removes pending uploads', async () => {
    const { uploadId } = await pendingSession();
    const response = await fetch(
      `${baseUrl}/patients/${PATIENT}/trash?type=delete`,
      { method: 'POST' }
    );
    expect(response.status).toBe(200);
    expect(await readdir(path.join(tmp, 'sessions'))).not.toContain(uploadId);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('trashing a patient also removes pending uploads', async () => {
    const { uploadId } = await pendingSession();
    const response = await fetch(`${baseUrl}/patients/${PATIENT}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(200);
    expect(await readdir(path.join(tmp, 'sessions'))).not.toContain(uploadId);
  });

  it('reports a failed database delete as a generic 500 and logs it', async () => {
    const { uploadId } = await pendingSession();
    destroyImpl = async () => {
      throw new Error('FK violation on /secret/path');
    };
    const response = await fetch(
      `${baseUrl}/patients/${PATIENT}/trash?type=delete`,
      { method: 'POST' }
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('/secret/path');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PATIENT }),
      'patient delete failed'
    );
    // Nothing was deleted, so the upload stays.
    expect(await readdir(path.join(tmp, 'sessions'))).toContain(uploadId);
    await sessions.cancelForPatient(PATIENT);
  });

  it('does not fail the deletion when removing upload sessions fails', async () => {
    const spy = jest
      .spyOn(sessions, 'cancelForPatient')
      .mockRejectedValueOnce(new Error('disk error'));
    const response = await fetch(
      `${baseUrl}/patients/${PATIENT}/trash?type=delete`,
      { method: 'POST' }
    );
    expect(response.status).toBe(200);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PATIENT }),
      'removing upload sessions of a deleted patient failed'
    );
    spy.mockRestore();
  });
});
