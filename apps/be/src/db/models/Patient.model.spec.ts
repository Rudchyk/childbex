/**
 * The permanent-delete hook removes the patient's upload directory after the
 * row was deleted; it must never fail the completed deletion.
 * Hooks are run directly, so no database is needed.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type * as PatientModel from './Patient.model';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('../../services/logger.service', () => ({ logger: mockLogger }));

jest.mock('../../utils', () => {
  const actual = jest.requireActual('../../utils');
  return { ...actual, removePath: jest.fn(actual.removePath) };
});

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';

let uploadRoot: string;
let Patient: typeof PatientModel.Patient;
let removePath: jest.Mock;

beforeAll(async () => {
  uploadRoot = await mkdtemp(path.join(os.tmpdir(), 'childbex-patient-hook-'));
  process.env.UPLOAD_ROOT = uploadRoot;
  // Modules read UPLOAD_ROOT at load time. Load order as in the app
  // (the service first) to respect the existing model/service import cycle.
  jest.requireActual('../../services/patients.service');
  ({ Patient } = jest.requireActual('./Patient.model') as typeof PatientModel);
  ({ removePath } = jest.requireMock('../../utils'));
});

afterAll(async () => {
  delete process.env.UPLOAD_ROOT;
  await rm(uploadRoot, { recursive: true, force: true });
});

beforeEach(() => jest.clearAllMocks());

const runAfterDestroy = (force: boolean) =>
  (
    Patient as unknown as {
      runHooks(name: string, ...args: unknown[]): Promise<void>;
    }
  ).runHooks('afterDestroy', Patient.build({ id: PATIENT_ID } as never), {
    force,
  });

describe('Patient afterDestroy', () => {
  it('succeeds when the patient never had an upload directory', async () => {
    await expect(runAfterDestroy(true)).resolves.toBeUndefined();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('removes the upload directory on permanent delete', async () => {
    const dir = path.join(uploadRoot, PATIENT_ID, 'cluster');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'IM1'), 'x');
    await runAfterDestroy(true);
    expect(await readdir(uploadRoot)).toEqual([]);
  });

  it('keeps files when the patient is only trashed', async () => {
    await mkdir(path.join(uploadRoot, PATIENT_ID), { recursive: true });
    await runAfterDestroy(false);
    expect(await readdir(uploadRoot)).toEqual([PATIENT_ID]);
    await rm(path.join(uploadRoot, PATIENT_ID), { recursive: true });
  });

  it('logs, but does not throw, when cleanup fails for another reason', async () => {
    removePath.mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' })
    );
    await expect(runAfterDestroy(true)).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: PATIENT_ID }),
      expect.stringContaining('removing its upload directory failed')
    );
  });
});
