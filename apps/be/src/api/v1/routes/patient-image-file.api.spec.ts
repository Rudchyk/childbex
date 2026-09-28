/**
 * Authenticated DICOM file serving over real HTTP (Express + fets), with a
 * fake Keycloak (user taken from a test header), real files in a temporary
 * upload root and the image lookup query mocked (no database).
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type * as ApiModule from '../api';
import { makeSyntheticDicom } from '../../../services/archive/__fixtures__/synthetic';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
};
jest.mock('../../../services/logger.service', () => ({ logger: mockLogger }));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const OTHER_PATIENT = '22222222-2222-4222-8222-222222222222';
const CLUSTER = '33333333-3333-4333-8333-333333333333';
const IMAGE = '44444444-4444-4444-8444-444444444444';
const LARGE_IMAGE = '55555555-5555-4555-8555-555555555555';
const MISSING_FILE_IMAGE = '66666666-6666-4666-8666-666666666666';
const TRAVERSAL_IMAGE = '77777777-7777-4777-8777-777777777777';
const ABSOLUTE_IMAGE = '88888888-8888-4888-8888-888888888888';
const SYMLINK_IMAGE = '99999999-9999-4999-8999-999999999999';
const UNKNOWN_IMAGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** Original file name from the archive; must never appear in logs. */
const ORIGINAL_NAME = 'Doe_John_CT_0001.dcm';

const dicom = makeSyntheticDicom({ rows: 16, cols: 16 });
// Several stream chunks (64 KiB each): exercises streaming, not one write.
const largeDicom = makeSyntheticDicom({ rows: 1024, cols: 1024 });
const outsideSecret = Buffer.from('outside the upload root');

let tmp: string;
let uploadRoot: string;
let server: Server;
let baseUrl: string;
let findOne: jest.SpyInstance;

type ImageRow = { id: string; patientId: string; source: string };
let rows: ImageRow[] = [];

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

const source = (name: string) => `/uploads/${PATIENT}/${CLUSTER}/${name}`;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'childbex-image-file-'));
  uploadRoot = path.join(tmp, 'uploads');
  process.env.UPLOAD_ROOT = uploadRoot;
  process.env.UPLOAD_SESSIONS_DIR = path.join(tmp, 'sessions');

  const folder = path.join(uploadRoot, PATIENT, CLUSTER);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, ORIGINAL_NAME), dicom);
  await writeFile(path.join(folder, 'large.dcm'), largeDicom);
  await writeFile(path.join(tmp, 'outside.dcm'), outsideSecret);
  // A directory link inside the upload root pointing outside of it. The
  // 'junction' type needs no extra privileges on Windows and is an ordinary
  // directory symlink elsewhere.
  const outsideDir = path.join(tmp, 'outside-dir');
  await mkdir(outsideDir);
  await writeFile(path.join(outsideDir, 'secret.dcm'), outsideSecret);
  await symlink(outsideDir, path.join(folder, 'linked-dir'), 'junction');

  rows = [
    { id: IMAGE, patientId: PATIENT, source: source(ORIGINAL_NAME) },
    { id: LARGE_IMAGE, patientId: PATIENT, source: source('large.dcm') },
    { id: MISSING_FILE_IMAGE, patientId: PATIENT, source: source('gone.dcm') },
    // Stored sources that point outside of the upload root.
    { id: TRAVERSAL_IMAGE, patientId: PATIENT, source: '/uploads/../outside.dcm' },
    {
      id: ABSOLUTE_IMAGE,
      patientId: PATIENT,
      source: path.join(tmp, 'outside.dcm'),
    },
    {
      id: SYMLINK_IMAGE,
      patientId: PATIENT,
      source: source('linked-dir/secret.dcm'),
    },
  ];

  const { setupAPIRoutes } = require('../api') as typeof ApiModule;
  const { PatientImage } = require('../../../db/models/PatientImage.model');

  // Behaves like the SQL query: the image must belong to a cluster of the
  // requested patient.
  findOne = jest.spyOn(PatientImage, 'findOne').mockImplementation((async (
    options: {
      where: { id: string };
      include: { where: { patientId: string } }[];
    }
  ) => {
    const row = rows.find(
      ({ id, patientId }) =>
        id === options.where.id &&
        patientId === options.include[0].where.patientId
    );
    return row ? { id: row.id, source: row.source } : null;
  }) as never);

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
});

const getFile = (
  patientId: string,
  imageId: string,
  user: string | null = 'user-a'
) =>
  fetch(`${baseUrl}/patients/${patientId}/images/${imageId}/file`, {
    headers: user ? { 'x-test-user': user } : {},
  });

const bodyBytes = async (response: Response) =>
  Buffer.from(await response.arrayBuffer());

const expectNotServed = async (response: Response, ...secrets: Buffer[]) => {
  expect(response.headers.get('content-type')).not.toBe('application/dicom');
  const body = await bodyBytes(response);
  for (const secret of secrets) {
    expect(body.includes(secret)).toBe(false);
  }
};

describe('GET /patients/:id/images/:imageId/file', () => {
  it('rejects unauthenticated requests with 401 without touching the file', async () => {
    const response = await getFile(PATIENT, IMAGE, null);

    expect(response.status).toBe(401);
    await expectNotServed(response, dicom);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('streams the DICOM file of the patient image with safe headers', async () => {
    const response = await getFile(PATIENT, IMAGE);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/dicom');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(response.headers.get('content-length')).toBe(String(dicom.length));
    expect((await bodyBytes(response)).equals(dicom)).toBe(true);
  });

  it('streams a file larger than one read chunk unchanged', async () => {
    const response = await getFile(PATIENT, LARGE_IMAGE);

    expect(response.status).toBe(200);
    expect((await bodyBytes(response)).equals(largeDicom)).toBe(true);
  });

  it('queries the image only through a live patient of the requested id', async () => {
    await (await getFile(PATIENT, IMAGE)).arrayBuffer();

    const [options] = findOne.mock.calls[0];
    expect(options.where).toEqual({ id: IMAGE });
    const [cluster] = options.include;
    expect(cluster.where).toEqual({ patientId: PATIENT });
    expect(cluster.required).toBe(true);
    // Paranoid (not `paranoid: false`): trashed patients are not found.
    expect(cluster.include[0].required).toBe(true);
    expect(cluster.include[0].paranoid).toBeUndefined();
  });

  it('returns 404 for an unknown image', async () => {
    const response = await getFile(PATIENT, UNKNOWN_IMAGE);

    expect(response.status).toBe(404);
  });

  it('returns 404 for an image of another patient', async () => {
    const response = await getFile(OTHER_PATIENT, IMAGE);

    expect(response.status).toBe(404);
    await expectNotServed(response, dicom);
  });

  it('returns 404 when the stored file is missing, logging ids only', async () => {
    const response = await getFile(PATIENT, MISSING_FILE_IMAGE);

    expect(response.status).toBe(404);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { patientId: PATIENT, imageId: MISSING_FILE_IMAGE, reason: 'missing' },
      expect.any(String)
    );
  });

  it.each([
    ['a relative traversal', TRAVERSAL_IMAGE],
    ['an absolute path', ABSOLUTE_IMAGE],
  ])(
    'never serves a file outside the upload root (stored %s)',
    async (_, imageId) => {
      const response = await getFile(PATIENT, imageId);

      expect(response.status).toBe(404);
      await expectNotServed(response, outsideSecret);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        { patientId: PATIENT, imageId, reason: 'outside_upload_root' },
        expect.any(String)
      );
    }
  );

  it('never follows a symlink out of the upload root', async () => {
    const response = await getFile(PATIENT, SYMLINK_IMAGE);

    expect(response.status).toBe(404);
    await expectNotServed(response, outsideSecret);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { patientId: PATIENT, imageId: SYMLINK_IMAGE, reason: 'outside_upload_root' },
      expect.any(String)
    );
  });

  it.each([
    '..%2F..%2Foutside.dcm',
    '..',
    'not-a-uuid',
    encodeURIComponent(`${PATIENT}/${CLUSTER}/${ORIGINAL_NAME}`),
  ])('does not accept a path as the image id (%s)', async (imageId) => {
    const response = await getFile(PATIENT, imageId);

    expect([400, 404]).toContain(response.status);
    await expectNotServed(response, dicom, outsideSecret);
  });

  it('never logs file paths or original file names', async () => {
    for (const imageId of [
      IMAGE,
      MISSING_FILE_IMAGE,
      TRAVERSAL_IMAGE,
      ABSOLUTE_IMAGE,
    ]) {
      await (await getFile(PATIENT, imageId)).arrayBuffer();
    }

    const logged = JSON.stringify(
      Object.values(mockLogger).flatMap((fn) => fn.mock.calls)
    );
    expect(logged).not.toContain(ORIGINAL_NAME);
    expect(logged).not.toContain('outside.dcm');
    expect(logged).not.toContain(JSON.stringify(tmp).slice(1, -1));
  });
});
