import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UploadSessionStatus, type UploadSessionResult } from '@libs/schemas';
import { ArchiveError } from '../archive/archive.errors';
import type { UploadSessionConfig } from './upload-session.config';
import {
  UploadSessionService,
  type ImportArchiveRequest,
} from './upload-session.service';

jest.mock('../logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const OWNER = 'user-a';
const PATIENT = '11111111-1111-4111-8111-111111111111';
const CHUNK = 10;
const RESULT: UploadSessionResult = {
  importedImages: 3,
  alreadyImported: 0,
  clusters: 1,
  brokenImages: 0,
  skippedFiles: 0,
};

let root: string;
let now: number;
let service: UploadSessionService;
let imported: { request: ImportArchiveRequest; bytes: Buffer }[];
let importImpl: (request: ImportArchiveRequest) => Promise<UploadSessionResult>;
let patientExists: boolean;

const config = (overrides: Partial<UploadSessionConfig> = {}) => ({
  rootDir: root,
  chunkSizeBytes: CHUNK,
  maxFileBytes: 1000,
  maxActiveSessionsPerUser: 3,
  maxActiveBytesTotal: 10_000,
  sessionTtlMs: 60_000,
  finishedRetentionMs: 10_000,
  incomingMaxAgeMs: 5_000,
  cleanupIntervalMs: 60_000,
  maxConcurrentChunkWrites: 4,
  minFreeDiskBytes: 0,
  ...overrides,
});

const createService = (overrides: Partial<UploadSessionConfig> = {}) =>
  new UploadSessionService(config(overrides), {
    importArchive: (request) => importImpl(request),
    patientExists: async () => patientExists,
    now: () => now,
  });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'childbex-sessions-'));
  now = Date.parse('2026-01-01T00:00:00Z');
  imported = [];
  patientExists = true;
  importImpl = async (request) => {
    imported.push({ request, bytes: await readFile(request.archivePath) });
    return RESULT;
  };
  service = createService();
  await service.init();
});

afterEach(async () => {
  await service.whenIdle();
  await rm(root, { recursive: true, force: true });
});

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function* bodyOf(...parts: Buffer[]) {
  for (const part of parts) yield new Uint8Array(part);
}

// 25 bytes -> chunks of 10, 10, 5.
const FILE = Buffer.from('synthetic-archive-bytes!!');
const chunkOf = (index: number) =>
  FILE.subarray(index * CHUNK, Math.min(FILE.length, (index + 1) * CHUNK));

const createSession = (fileName = 'study.tar.gz', fileSize = FILE.length) =>
  service.create({ patientId: PATIENT, ownerSub: OWNER, fileName, fileSize });

const put = (
  uploadId: string,
  index: number,
  overrides: Partial<Parameters<UploadSessionService['putChunk']>[0]> = {}
) => {
  const data = chunkOf(index);
  return service.putChunk({
    uploadId,
    ownerSub: OWNER,
    index: String(index),
    chunkCount: '3',
    sha256: sha(data),
    contentLength: String(data.length),
    body: bodyOf(data),
    ...overrides,
  });
};

const uploadAll = async (uploadId: string, order = [0, 1, 2]) => {
  for (const index of order) await put(uploadId, index);
};

const expectCode = async (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

const sessionFiles = async (uploadId: string) =>
  (await readdir(path.join(root, uploadId, 'chunks')).catch(() => [])).sort();

describe('create', () => {
  it('creates a session with server-defined chunking', async () => {
    const session = await createSession();
    expect(session).toMatchObject({
      patientId: PATIENT,
      status: UploadSessionStatus.UPLOADING,
      fileSize: 25,
      chunkSize: CHUNK,
      totalChunks: 3,
      receivedChunks: [],
      missingChunks: [0, 1, 2],
    });
    const record = JSON.parse(
      await readFile(path.join(root, session.uploadId, 'session.json'), 'utf8')
    );
    // The client file name is never stored.
    expect(JSON.stringify(record)).not.toContain('study');
    expect(record.extension).toBe('.tar.gz');
  });

  it.each([
    ['study.rar', /RAR/],
    ['study.7z', /7z/],
    ['study.pdf', /Unsupported archive type/],
  ])('rejects %s before any upload', async (fileName, message) => {
    const promise = createSession(fileName);
    await expectCode(promise, 'UNSUPPORTED_FORMAT');
    await expect(promise).rejects.toThrow(message);
  });

  it('rejects files above the final archive size limit', async () => {
    await expectCode(createSession('a.zip', 1001), 'UPLOAD_TOO_LARGE');
  });

  it('limits unfinished sessions per user', async () => {
    await createSession();
    await createSession();
    await createSession();
    await expectCode(createSession(), 'TOO_MANY_SESSIONS');
    // Other users are not affected.
    await expect(
      service.create({
        patientId: PATIENT,
        ownerSub: 'user-b',
        fileName: 'a.zip',
        fileSize: 25,
      })
    ).resolves.toBeDefined();
  });

  it('limits the total size of unfinished sessions', async () => {
    service = createService({ maxActiveBytesTotal: 40 });
    await createSession();
    await expectCode(createSession(), 'INSUFFICIENT_STORAGE');
  });
});

describe('putChunk validation', () => {
  let uploadId: string;
  beforeEach(async () => {
    ({ uploadId } = await createSession());
  });

  it.each([
    [
      'an unknown upload id',
      { uploadId: '22222222-2222-4222-8222-222222222222' },
      'SESSION_NOT_FOUND',
    ],
    ['a malformed upload id', { uploadId: '../../etc' }, 'SESSION_NOT_FOUND'],
    ["another user's session", { ownerSub: 'user-b' }, 'SESSION_NOT_FOUND'],
    ['an index out of range', { index: '3' }, 'INVALID_CHUNK'],
    ['a negative index', { index: '-1' }, 'INVALID_CHUNK'],
    ['a non-canonical index', { index: '01' }, 'INVALID_CHUNK'],
    ['a wrong chunk count', { chunkCount: '4' }, 'INVALID_CHUNK'],
    ['a missing chunk count', { chunkCount: null }, 'INVALID_CHUNK'],
    ['a missing checksum', { sha256: null }, 'INVALID_CHUNK'],
    ['a malformed checksum', { sha256: 'abc' }, 'INVALID_CHUNK'],
    ['a missing Content-Length', { contentLength: null }, 'LENGTH_REQUIRED'],
    [
      'a Content-Length above the chunk size',
      { contentLength: '11' },
      'CHUNK_TOO_LARGE',
    ],
    [
      'a Content-Length below the chunk size',
      { contentLength: '9' },
      'INVALID_CHUNK',
    ],
  ] as const)('rejects %s', async (_label, overrides, code) => {
    await expectCode(put(uploadId, 0, overrides), code);
    expect(await sessionFiles(uploadId)).toEqual([]);
  });

  it('rejects a body longer than declared and removes the partial file', async () => {
    const data = chunkOf(0);
    await expectCode(
      put(uploadId, 0, { body: bodyOf(data, Buffer.from('extra')) }),
      'CHUNK_TOO_LARGE'
    );
    expect(await sessionFiles(uploadId)).toEqual([]);
  });

  it('rejects a truncated body (interrupted upload) and removes the partial file', async () => {
    await expectCode(
      put(uploadId, 0, { body: bodyOf(chunkOf(0).subarray(0, 4)) }),
      'INVALID_CHUNK'
    );
    expect(await sessionFiles(uploadId)).toEqual([]);
  });

  it('removes the partial file when the connection aborts mid-body', async () => {
    async function* aborted() {
      yield new Uint8Array(chunkOf(0).subarray(0, 4));
      throw new Error('aborted');
    }
    await expect(put(uploadId, 0, { body: aborted() })).rejects.toThrow(
      'aborted'
    );
    expect(await sessionFiles(uploadId)).toEqual([]);
  });

  it('rejects a checksum mismatch', async () => {
    await expectCode(
      put(uploadId, 0, { sha256: sha(Buffer.from('other-data')) }),
      'CHUNK_CHECKSUM_MISMATCH'
    );
    expect(await sessionFiles(uploadId)).toEqual([]);
  });

  it('limits concurrent chunk writes per session', async () => {
    service = createService({ maxConcurrentChunkWrites: 1 });
    let release: () => void = () => undefined;
    let reading: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const bodyStarted = new Promise<void>((resolve) => (reading = resolve));
    async function* slow() {
      reading();
      await gate;
      yield new Uint8Array(chunkOf(0));
    }
    const first = put(uploadId, 0, { body: slow() });
    // Wait until the first chunk is actually being received.
    await bodyStarted;
    await expectCode(put(uploadId, 1), 'TOO_MANY_REQUESTS');
    release();
    await expect(first).resolves.toMatchObject({ stored: true });
  });
});

describe('duplicates and resume', () => {
  it('treats a repeated chunk with the same checksum as an idempotent success', async () => {
    const { uploadId } = await createSession();
    await expect(put(uploadId, 0)).resolves.toMatchObject({ stored: true });
    let bodyRead = false;
    async function* tracked() {
      bodyRead = true;
      yield new Uint8Array(chunkOf(0));
    }
    await expect(put(uploadId, 0, { body: tracked() })).resolves.toMatchObject({
      stored: false,
    });
    expect(bodyRead).toBe(false);
  });

  it('rejects a different chunk for an already stored index', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 0);
    const other = Buffer.from('0123456789');
    await expectCode(
      put(uploadId, 0, { sha256: sha(other), body: bodyOf(other) }),
      'CHUNK_CONFLICT'
    );
  });

  it('stores concurrent duplicate requests exactly once', async () => {
    const { uploadId } = await createSession();
    const results = await Promise.all([put(uploadId, 1), put(uploadId, 1)]);
    expect(results.map((r) => r.stored).sort()).toEqual([false, true]);
    expect(await sessionFiles(uploadId)).toEqual(['000001.chunk']);
  });

  it('reports received and missing chunks for resuming', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 2);
    await put(uploadId, 0);
    await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
      receivedChunks: [0, 2],
      missingChunks: [1],
    });
  });
});

describe('complete', () => {
  it('refuses to complete while chunks are missing', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 0);
    const promise = service.complete(uploadId, OWNER);
    await expectCode(promise, 'CHUNKS_MISSING');
    await expect(promise).rejects.toMatchObject({
      details: { missingChunks: [1, 2] },
    });
  });

  it('assembles chunks in index order and hands the archive to the import', async () => {
    const { uploadId } = await createSession();
    await uploadAll(uploadId, [2, 0, 1]);
    const started = await service.complete(uploadId, OWNER);
    expect(started.status).toBe(UploadSessionStatus.ASSEMBLING);
    await service.whenIdle();

    expect(imported).toHaveLength(1);
    expect(imported[0].bytes).toEqual(FILE);
    expect(imported[0].request).toMatchObject({
      uploadId,
      patientId: PATIENT,
      extension: '.tar.gz',
      size: FILE.length,
      sha256: sha(FILE),
    });
    await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
      status: UploadSessionStatus.COMPLETED,
      result: RESULT,
    });
    // No temporary data is left once the import succeeded.
    expect(await readdir(path.join(root, uploadId))).toEqual(['session.json']);
  });

  it('is idempotent and never imports twice (concurrent and repeated calls)', async () => {
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await Promise.all([
      service.complete(uploadId, OWNER),
      service.complete(uploadId, OWNER),
      service.complete(uploadId, OWNER),
    ]);
    await service.whenIdle();
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    expect(imported).toHaveLength(1);
  });

  it('rejects chunks once the upload is being completed', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 0);
    await put(uploadId, 1);
    const last = chunkOf(2);
    await put(uploadId, 2);
    await service.complete(uploadId, OWNER);
    await expectCode(
      put(uploadId, 2, {
        sha256: sha(Buffer.from('xxxxx')),
        body: bodyOf(Buffer.from('xxxxx')),
        contentLength: String(last.length),
      }),
      'SESSION_NOT_UPLOADING'
    );
  });

  it('asks for damaged chunks again instead of failing the upload', async () => {
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await writeFile(
      path.join(root, uploadId, 'chunks', '000001.chunk'),
      'XXXXXXXXXX'
    );
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
      status: UploadSessionStatus.UPLOADING,
      missingChunks: [1],
      error: { code: 'CHUNKS_MISSING' },
    });
    expect(imported).toHaveLength(0);

    await put(uploadId, 1);
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    expect(imported[0].bytes).toEqual(FILE);
  });

  it('fails permanently and deletes the data when archive validation fails', async () => {
    importImpl = async () => {
      throw new ArchiveError('NO_USABLE_DICOM', 'No usable DICOM images.');
    };
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
      status: UploadSessionStatus.FAILED,
      retryable: false,
      error: { code: 'NO_USABLE_DICOM', message: 'No usable DICOM images.' },
    });
    expect(await readdir(path.join(root, uploadId))).toEqual(['session.json']);
  });

  it.each([
    ['an unexpected server error', new Error('database unavailable')],
    [
      'a server-side extraction failure',
      new ArchiveError('EXTRACTION_FAILED', 'disk problem'),
    ],
  ])(
    'keeps the assembled archive and allows a retry after %s',
    async (_l, error) => {
      importImpl = async () => {
        throw error;
      };
      const { uploadId } = await createSession();
      await uploadAll(uploadId);
      await service.complete(uploadId, OWNER);
      await service.whenIdle();
      const failed = await service.get(uploadId, OWNER);
      expect(failed).toMatchObject({
        status: UploadSessionStatus.FAILED,
        retryable: true,
        error: { code: 'PROCESSING_FAILED' },
      });
      expect(failed.error?.message).not.toContain('database');

      importImpl = async (request) => {
        imported.push({ request, bytes: await readFile(request.archivePath) });
        return RESULT;
      };
      await service.complete(uploadId, OWNER);
      await service.whenIdle();
      expect(imported[0].bytes).toEqual(FILE);
      await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
        status: UploadSessionStatus.COMPLETED,
      });
    }
  );

  it('fails permanently when the patient was deleted during the upload', async () => {
    patientExists = false;
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
      status: UploadSessionStatus.FAILED,
      retryable: false,
      error: { code: 'PATIENT_NOT_FOUND' },
    });
    expect(imported).toHaveLength(0);
  });
});

describe('cancel', () => {
  it('deletes the session and all its data', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 0);
    await service.cancel(uploadId, OWNER);
    await expect(stat(path.join(root, uploadId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expectCode(service.get(uploadId, OWNER), 'SESSION_NOT_FOUND');
  });

  it('refuses to cancel while the archive is being processed', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    importImpl = async () => {
      await gate;
      return RESULT;
    };
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await service.complete(uploadId, OWNER);
    await expectCode(service.cancel(uploadId, OWNER), 'SESSION_BUSY');
    release();
  });
});

describe('cancelForPatient', () => {
  const OTHER_PATIENT = '33333333-3333-4333-8333-333333333333';

  it("removes the patient's unfinished sessions only and frees the quota", async () => {
    const first = await createSession();
    await put(first.uploadId, 0);
    const second = await createSession();
    const other = await service.create({
      patientId: OTHER_PATIENT,
      ownerSub: OWNER,
      fileName: 'a.zip',
      fileSize: 25,
    });
    // Per-user quota (3) is exhausted.
    await expectCode(createSession(), 'TOO_MANY_SESSIONS');

    await expect(service.cancelForPatient(PATIENT)).resolves.toBe(2);

    expect(await readdir(root)).toEqual([other.uploadId]);
    await expectCode(service.get(first.uploadId, OWNER), 'SESSION_NOT_FOUND');
    await expectCode(service.get(second.uploadId, OWNER), 'SESSION_NOT_FOUND');
    await expect(createSession()).resolves.toBeDefined();
  });

  it('also removes a retryable failed session (assembled data included)', async () => {
    importImpl = async () => {
      throw new Error('database unavailable');
    };
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    await expect(service.cancelForPatient(PATIENT)).resolves.toBe(1);
    expect(await readdir(root)).toEqual([]);
  });

  it('leaves a session that is being imported alone', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    importImpl = async () => {
      await gate;
      return RESULT;
    };
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await service.complete(uploadId, OWNER);

    await expect(service.cancelForPatient(PATIENT)).resolves.toBe(0);
    expect(await readdir(root)).toEqual([uploadId]);
    release();
  });
});

describe('cleanup', () => {
  it('deletes expired unfinished sessions', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 0);
    now += 60_001;
    await expectCode(service.get(uploadId, OWNER), 'SESSION_NOT_FOUND');
    await service.cleanup();
    expect(await readdir(root)).toEqual([]);
  });

  it('keeps finished session status only for the retention period', async () => {
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    await service.complete(uploadId, OWNER);
    await service.whenIdle();
    now += 9_000;
    await service.cleanup();
    await expect(service.get(uploadId, OWNER)).resolves.toMatchObject({
      status: UploadSessionStatus.COMPLETED,
    });
    now += 2_000;
    await service.cleanup();
    expect(await readdir(root)).toEqual([]);
  });

  it('removes stale partial chunk files but keeps stored chunks', async () => {
    const { uploadId } = await createSession();
    await put(uploadId, 0);
    const stale = path.join(root, uploadId, 'chunks', '.incoming-1-abcdef');
    await writeFile(stale, 'partial');
    const old = new Date(now - 10_000);
    await utimes(stale, old, old);
    await service.cleanup();
    expect(await sessionFiles(uploadId)).toEqual(['000000.chunk']);
  });

  it('recovers sessions interrupted by a restart', async () => {
    const { uploadId } = await createSession();
    await uploadAll(uploadId);
    // Simulate a crash during assembly: status persisted, no job running.
    const recordPath = path.join(root, uploadId, 'session.json');
    const record = JSON.parse(await readFile(recordPath, 'utf8'));
    await writeFile(
      recordPath,
      JSON.stringify({ ...record, status: 'assembling' })
    );
    await mkdir(path.join(root, uploadId, 'assemble.lock'));

    const restarted = createService();
    await restarted.init();
    await expect(restarted.get(uploadId, OWNER)).resolves.toMatchObject({
      status: UploadSessionStatus.UPLOADING,
      missingChunks: [],
    });
    await restarted.complete(uploadId, OWNER);
    await restarted.whenIdle();
    expect(imported[0].bytes).toEqual(FILE);
  });

  it('refuses a session directory inside a publicly served directory', async () => {
    const unsafe = new UploadSessionService(
      config({ rootDir: path.join(root, 'public', 'sessions') }),
      {
        importArchive: importImpl,
        patientExists: async () => true,
        publicRoots: [path.join(root, 'public')],
      }
    );
    await expect(unsafe.init()).rejects.toThrow(/publicly served/);
  });
});
