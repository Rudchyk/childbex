/**
 * @jest-environment node
 */
import { createHash } from 'node:crypto';
import type { UploadSession } from '@libs/schemas';
import {
  archiveExtensionOf,
  findResumableSession,
  fingerprintSource,
  isResumableFor,
  resumeHintKey,
  uploadArchive,
  UploadRequestError,
  type ResumeStore,
  type UploadProgress,
  type UploadTransport,
} from './chunkedUpload';

const PATIENT = 'patient-1';

type Status = UploadSession['status'];
/** Session statuses as plain strings (the shared type is a TypeBox enum). */
const status = (value: `${Status}`) => value as Status;
const CHUNK = 10;

const hashChunk = async (data: Blob) =>
  createHash('sha256')
    .update(Buffer.from(await data.arrayBuffer()))
    .digest('hex');

const noSleep = async (_ms: number, signal?: AbortSignal) => {
  signal?.throwIfAborted();
};

/** In-memory stand-in for the upload session API. */
class FakeServer implements UploadTransport {
  sessions = new Map<string, UploadSession & { stored: Map<number, Buffer> }>();
  puts: number[] = [];
  active = 0;
  maxActive = 0;
  failPut = new Map<number, UploadRequestError[]>();
  /** Status sequence returned by getSession while processing. */
  processing: Status[] = [status('processing'), status('completed')];
  onComplete?: (session: UploadSession) => void;
  creates = 0;
  private nextId = 1;

  private view(id: string): UploadSession {
    const s = this.sessions.get(id);
    if (!s) throw new UploadRequestError('Not found', 404);
    const received = [...s.stored.keys()].sort((a, b) => a - b);
    return {
      ...s,
      receivedChunks: received,
      missingChunks: Array.from({ length: s.totalChunks }, (_, i) => i).filter(
        (i) => !s.stored.has(i)
      ),
    };
  }

  async createSession(
    patientId: string,
    body: { fileName?: string; fileSize: number; clientFingerprint?: string }
  ) {
    this.creates++;
    const uploadId = `upload-${this.nextId++}`;
    this.sessions.set(uploadId, {
      uploadId,
      patientId,
      status: status('uploading'),
      fileSize: body.fileSize,
      extension: archiveExtensionOf(body.fileName ?? 'x.tar.gz') ?? '',
      clientFingerprint: body.clientFingerprint,
      chunkSize: CHUNK,
      totalChunks: Math.ceil(body.fileSize / CHUNK),
      receivedChunks: [],
      missingChunks: [],
      expiresAt: new Date().toISOString(),
      retryable: false,
      stored: new Map(),
    } as UploadSession & { stored: Map<number, Buffer> });
    return this.view(uploadId);
  }

  async patientExists() {
    return true;
  }

  async listSessions() {
    return [...this.sessions.keys()]
      .map((id) => this.view(id))
      .filter(
        (s) =>
          s.status !== 'completed' && !(s.status === 'failed' && !s.retryable)
      );
  }

  async getSession(uploadId: string) {
    const s = this.sessions.get(uploadId);
    if (s && (s.status === 'processing' || s.status === 'assembling')) {
      s.status = this.processing.shift() ?? status('completed');
    }
    return this.view(uploadId);
  }

  async putChunk({
    uploadId,
    index,
    totalChunks,
    sha256,
    data,
    onProgress,
    signal,
  }: Parameters<UploadTransport['putChunk']>[0]) {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      signal.throwIfAborted();
      const failure = this.failPut.get(index)?.shift();
      if (failure) throw failure;
      const s = this.sessions.get(uploadId);
      if (!s) throw new UploadRequestError('Not found', 404);
      expect(totalChunks).toBe(s.totalChunks);
      const bytes = Buffer.from(await data.arrayBuffer());
      expect(sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      onProgress(bytes.length);
      s.stored.set(index, bytes);
      this.puts.push(index);
    } finally {
      this.active--;
    }
  }

  async complete(uploadId: string) {
    const view = this.view(uploadId);
    if (view.missingChunks.length) {
      throw new UploadRequestError('Chunks missing', 409, 'CHUNKS_MISSING');
    }
    const s = this.sessions.get(uploadId)!;
    s.status = status('processing');
    this.onComplete?.(this.view(uploadId));
    return this.view(uploadId);
  }

  async cancel(uploadId: string) {
    this.sessions.delete(uploadId);
  }

  assembled(uploadId: string) {
    const s = this.sessions.get(uploadId)!;
    return Buffer.concat(
      [...s.stored.entries()].sort(([a], [b]) => a - b).map(([, b]) => b)
    );
  }
}

const memoryStore = (): ResumeStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
};

// 45 bytes -> 5 chunks (4 x 10 + 5).
const CONTENT = Buffer.from('0123456789abcdefghijABCDEFGHIJklmnopqrstUVWXY');
const makeFile = () =>
  new File([CONTENT], 'Some Patient.tar.gz', { lastModified: 1_700_000_000 });

let server: FakeServer;
let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
  server = new FakeServer();
  store = memoryStore();
});

const fingerprintOf = (file: File) =>
  createHash('sha256').update(fingerprintSource(file)).digest('hex');

const run = (overrides: Partial<Parameters<typeof uploadArchive>[0]> = {}) =>
  uploadArchive({
    file: makeFile(),
    fingerprint: fingerprintOf(overrides.file ?? makeFile()),
    patientId: PATIENT,
    transport: server,
    hashChunk,
    resumeStore: store,
    sleep: noSleep,
    concurrency: 2,
    ...overrides,
  });

describe('uploadArchive', () => {
  it('uploads every chunk once, reports progress and completes', async () => {
    const progress: UploadProgress[] = [];
    const session = await run({ onProgress: (p) => progress.push(p) });

    expect(session.status).toBe('completed');
    expect(server.puts.sort()).toEqual([0, 1, 2, 3, 4]);
    expect(server.assembled(session.uploadId).equals(CONTENT)).toBe(true);
    expect(server.maxActive).toBeLessThanOrEqual(2);
    expect(progress[0].phase).toBe('preparing');
    expect(progress.some((p) => p.phase === 'processing')).toBe(true);
    expect(progress.at(-1)).toMatchObject({ phase: 'completed', percent: 100 });
    // Percent never goes backwards while uploading.
    const uploading = progress.filter((p) => p.phase === 'uploading');
    uploading.forEach((p, i) =>
      expect(p.percent).toBeGreaterThanOrEqual(uploading[i - 1]?.percent ?? 0)
    );
    // Finished uploads are not resumed again.
    expect(store.data.size).toBe(0);
  });

  it('does not put the raw file name into the resume hint key', () => {
    const key = resumeHintKey(fingerprintOf(makeFile()));
    expect(key).not.toContain('Patient');
  });

  it('resumes a previous session and uploads only the missing chunks', async () => {
    const file = makeFile();
    const session = await server.createSession(PATIENT, {
      fileName: file.name,
      fileSize: file.size,
      clientFingerprint: fingerprintOf(file),
    });
    const stored = server.sessions.get(session.uploadId)!.stored;
    stored.set(0, CONTENT.subarray(0, 10));
    stored.set(3, CONTENT.subarray(30, 40));
    store.set(resumeHintKey(fingerprintOf(file)), session.uploadId);

    const progress: UploadProgress[] = [];
    const result = await run({ file, onProgress: (p) => progress.push(p) });

    expect(result.uploadId).toBe(session.uploadId);
    expect(server.puts.sort()).toEqual([1, 2, 4]);
    expect(server.assembled(session.uploadId).equals(CONTENT)).toBe(true);
    // Progress starts from the bytes already on the server.
    expect(progress.find((p) => p.phase === 'uploading')?.uploadedBytes).toBe(
      20
    );
  });

  it('starts a new session when the saved one no longer exists', async () => {
    store.set(resumeHintKey(fingerprintOf(makeFile())), 'expired-session');
    const session = await run();
    expect(session.uploadId).toBe('upload-1');
    expect(server.puts).toHaveLength(5);
  });

  it('retries transient failures of a chunk', async () => {
    server.failPut.set(2, [
      new UploadRequestError('network', 0),
      new UploadRequestError('busy', 503),
    ]);
    const session = await run();
    expect(session.status).toBe('completed');
    expect(server.puts.filter((i) => i === 2)).toHaveLength(1);
  });

  it('fails fast on a non-retryable chunk error and keeps the session for resuming', async () => {
    server.failPut.set(1, [
      new UploadRequestError(
        'Checksum mismatch',
        400,
        'CHUNK_CHECKSUM_MISMATCH'
      ),
    ]);
    await expect(run()).rejects.toMatchObject({
      message: 'Checksum mismatch',
      retryable: false,
    });
    expect(store.data.size).toBe(1);
    // Retry continues the same session and uploads only what is missing.
    const before = server.puts.length;
    const session = await run();
    expect(session.status).toBe('completed');
    expect(server.puts.length - before).toBe(5 - before);
  });

  it('re-uploads chunks the server reports as damaged after completion', async () => {
    let first = true;
    server.onComplete = (session) => {
      if (!first) return;
      first = false;
      const s = server.sessions.get(session.uploadId)!;
      s.stored.delete(3);
      s.status = status('uploading');
    };
    const session = await run();
    expect(session.status).toBe('completed');
    expect(server.puts.filter((i) => i === 3)).toHaveLength(2);
  });

  it('reports a permanent import failure and forgets the session', async () => {
    server.processing = [status('processing')];
    server.onComplete = (session) => {
      const s = server.sessions.get(session.uploadId)!;
      server.processing = [];
      s.status = status('failed');
      s.retryable = false;
      s.error = {
        code: 'NO_USABLE_DICOM',
        message: 'The archive does not contain any usable DICOM images.',
      };
    };
    await expect(run()).rejects.toMatchObject({
      code: 'NO_USABLE_DICOM',
      retryable: false,
    });
    expect(store.data.size).toBe(0);
  });

  it('keeps a retryable processing failure resumable without re-uploading', async () => {
    let fail = true;
    server.onComplete = (session) => {
      if (!fail) return;
      fail = false;
      const s = server.sessions.get(session.uploadId)!;
      s.status = status('failed');
      s.retryable = true;
      s.error = { code: 'PROCESSING_FAILED', message: 'Server error' };
    };
    await expect(run()).rejects.toMatchObject({ retryable: true });
    expect(store.data.size).toBe(1);

    const session = await run();
    expect(session.status).toBe('completed');
    // No chunk was uploaded twice.
    expect(server.puts).toHaveLength(5);
  });

  it('stops when aborted and keeps the session for resuming', async () => {
    const controller = new AbortController();
    const promise = run({
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'uploading' && p.uploadedBytes >= 10)
          controller.abort();
      },
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.puts.length).toBeLessThan(5);
    expect(store.data.size).toBe(1);
  });
});

describe('recovering unfinished uploads', () => {
  const OTHER_PATIENT = 'patient-2';

  /** An unfinished session on the server with chunks 0 and 3 stored. */
  const existingSession = async (
    overrides: { patientId?: string; fileName?: string; fileSize?: number } = {}
  ) => {
    const file = makeFile();
    const session = await server.createSession(overrides.patientId ?? PATIENT, {
      fileName: overrides.fileName ?? file.name,
      fileSize: overrides.fileSize ?? file.size,
      clientFingerprint: fingerprintOf(file),
    });
    const stored = server.sessions.get(session.uploadId)!.stored;
    stored.set(0, CONTENT.subarray(0, 10));
    stored.set(3, CONTENT.subarray(30, 40));
    server.creates = 0;
    return session;
  };

  it('after a reload (no local state) resumes from the server list without a new session', async () => {
    const session = await existingSession();
    expect(store.data.size).toBe(0);

    const result = await run();

    expect(result.uploadId).toBe(session.uploadId);
    expect(server.creates).toBe(0);
    expect(server.puts.sort()).toEqual([1, 2, 4]);
    expect(server.assembled(session.uploadId).equals(CONTENT)).toBe(true);
  });

  it('resumes a session chosen by the user for its original patient', async () => {
    const session = await existingSession({ patientId: OTHER_PATIENT });
    const result = await run({ patientId: OTHER_PATIENT, session });
    expect(result.uploadId).toBe(session.uploadId);
    expect(result.patientId).toBe(OTHER_PATIENT);
    expect(server.creates).toBe(0);
    expect(server.puts.sort()).toEqual([1, 2, 4]);
  });

  it.each([
    ['a different file size', { fileSize: CONTENT.length + 1 }],
    ['a different archive type', { fileName: 'Some Patient.zip' }],
    ['another patient', { patientId: OTHER_PATIENT }],
  ])(
    'does not resume a session with the same fingerprint but %s',
    async (_label, overrides) => {
      const session = await existingSession(overrides);
      const result = await run();
      expect(result.uploadId).not.toBe(session.uploadId);
      expect(server.creates).toBe(1);
      expect(server.puts.sort()).toEqual([0, 1, 2, 3, 4]);
    }
  );

  it("ignores a local hint that points to another patient's session", async () => {
    const foreign = await existingSession({ patientId: OTHER_PATIENT });
    store.set(resumeHintKey(fingerprintOf(makeFile())), foreign.uploadId);
    const result = await run();
    expect(result.uploadId).not.toBe(foreign.uploadId);
    expect(result.patientId).toBe(PATIENT);
  });

  it('sends the fingerprint (not the file name) for new sessions', async () => {
    const result = await run();
    const created = server.sessions.get(result.uploadId)!;
    expect(created.clientFingerprint).toBe(fingerprintOf(makeFile()));
  });
});

describe('matching helpers', () => {
  const base = {
    uploadId: 'u1',
    patientId: PATIENT,
    status: status('uploading'),
    fileSize: 45,
    extension: '.tar.gz',
    clientFingerprint: 'fp_0123456789abcdef',
    chunkSize: CHUNK,
    totalChunks: 5,
    receivedChunks: [],
    missingChunks: [0, 1, 2, 3, 4],
    expiresAt: '',
    retryable: false,
  } as UploadSession;
  const criteria = {
    fingerprint: 'fp_0123456789abcdef',
    fileSize: 45,
    extension: '.tar.gz',
  };

  it('requires fingerprint, size and extension to match', () => {
    expect(isResumableFor(base, criteria)).toBe(true);
    expect(
      isResumableFor(base, { ...criteria, fingerprint: 'fp_other_000000000' })
    ).toBe(false);
    expect(isResumableFor(base, { ...criteria, fileSize: 46 })).toBe(false);
    expect(isResumableFor(base, { ...criteria, extension: '.zip' })).toBe(
      false
    );
    expect(
      isResumableFor({ ...base, clientFingerprint: undefined }, criteria)
    ).toBe(false);
  });

  it('only matches sessions that can still continue', () => {
    expect(
      isResumableFor({ ...base, status: status('completed') }, criteria)
    ).toBe(false);
    expect(
      isResumableFor({ ...base, status: status('failed') }, criteria)
    ).toBe(false);
    expect(
      isResumableFor(
        { ...base, status: status('failed'), retryable: true },
        criteria
      )
    ).toBe(true);
    expect(
      isResumableFor({ ...base, status: status('processing') }, criteria)
    ).toBe(true);
  });

  it('finds a match for any patient unless one is required', () => {
    expect(findResumableSession([base], criteria)).toBe(base);
    expect(
      findResumableSession([base], { ...criteria, patientId: 'x' })
    ).toBeUndefined();
  });

  it('gives the same file a different fingerprint when it was modified', () => {
    const a = new File([CONTENT], 'study.tar.gz', { lastModified: 1 });
    const b = new File([CONTENT], 'study.tar.gz', { lastModified: 2 });
    expect(fingerprintSource(a)).not.toBe(fingerprintSource(b));
    expect(archiveExtensionOf('STUDY.TAR.GZ')).toBe('.tar.gz');
    expect(archiveExtensionOf('study.rar')).toBeUndefined();
  });
});
