import type { UploadSession } from '@libs/schemas';

/** Network operations of the chunked upload API (injected for testability). */
export interface UploadTransport {
  createSession(
    patientId: string,
    body: { fileName: string; fileSize: number }
  ): Promise<UploadSession>;
  getSession(uploadId: string): Promise<UploadSession>;
  putChunk(args: {
    uploadId: string;
    index: number;
    totalChunks: number;
    sha256: string;
    data: Blob;
    onProgress: (loadedBytes: number) => void;
    signal: AbortSignal;
  }): Promise<void>;
  complete(uploadId: string): Promise<UploadSession>;
  cancel(uploadId: string): Promise<void>;
}

/** Error of an upload request; `status` 0 means a network failure. */
export class UploadRequestError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    retryable?: boolean
  ) {
    super(message);
    this.name = 'UploadRequestError';
    this.retryable =
      retryable ??
      (status === 0 ||
        status === 408 ||
        status === 429 ||
        (status >= 500 && status !== 507));
  }
}

/** Persists the upload id of an unfinished upload so it can be resumed. */
export interface ResumeStore {
  get(key: string): string | null;
  set(key: string, uploadId: string): void;
  remove(key: string): void;
}

export type UploadPhase =
  | 'preparing'
  | 'uploading'
  | 'processing'
  | 'completed';

export interface UploadProgress {
  phase: UploadPhase;
  uploadedBytes: number;
  totalBytes: number;
  /** 0–100, based on bytes confirmed or in flight. */
  percent: number;
}

export interface UploadArchiveOptions {
  file: File;
  patientId: string;
  transport: UploadTransport;
  /** Hex SHA-256 of a chunk. */
  hashChunk: (data: Blob) => Promise<string>;
  resumeStore?: ResumeStore;
  onProgress?: (progress: UploadProgress) => void;
  /** Called whenever the session is known/updated (e.g. to allow cancel). */
  onSession?: (session: UploadSession) => void;
  signal?: AbortSignal;
  /** Chunks uploaded in parallel. */
  concurrency?: number;
  /** Attempts per request for retryable errors. */
  maxAttempts?: number;
  retryDelayMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const MAX_COMPLETE_ROUNDS = 3;

/** FNV-1a hash, so no file name (possibly containing PHI) is persisted. */
const fnv1a = (value: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

/** Identifies "the same file for the same patient" across page reloads. */
export const resumeKey = (patientId: string, file: File) =>
  [
    'childbex.upload',
    patientId,
    file.size,
    file.lastModified,
    fnv1a(file.name),
  ].join(':');

const abortError = () => new DOMException('Upload cancelled', 'AbortError');

export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true }
    );
  });

export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

/**
 * Uploads an archive in chunks through an upload session and waits until the
 * server has imported it. Resumes a previous session for the same file (only
 * missing chunks are uploaded) and retries transient failures.
 */
export async function uploadArchive({
  file,
  patientId,
  transport,
  hashChunk,
  resumeStore,
  onProgress,
  onSession,
  signal,
  concurrency = 3,
  maxAttempts = 4,
  retryDelayMs = 1000,
  pollIntervalMs = 2000,
  sleep = defaultSleep,
}: UploadArchiveOptions): Promise<UploadSession> {
  const key = resumeKey(patientId, file);
  const totalBytes = file.size;
  const report = (phase: UploadPhase, uploadedBytes: number) =>
    onProgress?.({
      phase,
      uploadedBytes,
      totalBytes,
      percent: totalBytes
        ? Math.min(100, Math.floor((uploadedBytes / totalBytes) * 100))
        : 0,
    });

  const withRetry = async <T>(action: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await action();
      } catch (error) {
        const retryable =
          error instanceof UploadRequestError && error.retryable;
        if (!retryable || attempt >= maxAttempts || signal?.aborted) {
          throw error;
        }
        await sleep(retryDelayMs * 2 ** (attempt - 1), signal);
      }
    }
  };

  const chunkBytes = (session: UploadSession, index: number) =>
    Math.min(session.chunkSize, file.size - index * session.chunkSize);

  const resumeOrCreate = async (): Promise<UploadSession> => {
    const saved = resumeStore?.get(key);
    if (saved) {
      try {
        const session = await withRetry(() => transport.getSession(saved));
        const finished =
          session.status === 'completed' ||
          (session.status === 'failed' && !session.retryable);
        if (
          !finished &&
          session.patientId === patientId &&
          session.fileSize === file.size
        ) {
          return session;
        }
      } catch (error) {
        if (!(error instanceof UploadRequestError && error.status === 404)) {
          throw error;
        }
      }
      resumeStore?.remove(key);
    }
    return withRetry(() =>
      transport.createSession(patientId, {
        fileName: file.name,
        fileSize: file.size,
      })
    );
  };

  const uploadMissing = async (session: UploadSession) => {
    const queue = [...session.missingChunks];
    let confirmed = session.receivedChunks.reduce(
      (sum, index) => sum + chunkBytes(session, index),
      0
    );
    const inFlight = new Map<number, number>();
    const emit = () =>
      report(
        'uploading',
        confirmed + [...inFlight.values()].reduce((a, b) => a + b, 0)
      );
    emit();

    // Stop sibling workers as soon as one chunk fails for good.
    const workers = new AbortController();
    const onAbort = () => workers.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const work = async () => {
      for (
        let index = queue.shift();
        index !== undefined;
        index = queue.shift()
      ) {
        const current = index;
        workers.signal.throwIfAborted();
        const start = current * session.chunkSize;
        const data = file.slice(start, start + chunkBytes(session, current));
        const sha256 = await hashChunk(data);
        await withRetry(() =>
          transport.putChunk({
            uploadId: session.uploadId,
            index: current,
            totalChunks: session.totalChunks,
            sha256,
            data,
            signal: workers.signal,
            onProgress: (loaded) => {
              inFlight.set(current, loaded);
              emit();
            },
          })
        );
        inFlight.delete(current);
        confirmed += data.size;
        emit();
      }
    };

    const results = await Promise.allSettled(
      Array.from(
        { length: Math.max(1, Math.min(concurrency, queue.length)) },
        () =>
          work().catch((error) => {
            workers.abort();
            throw error;
          })
      )
    );
    signal?.removeEventListener('abort', onAbort);
    signal?.throwIfAborted();
    const failure = results.find(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && !isAbortError(r.reason)
    );
    if (failure) throw failure.reason;
  };

  const waitWhileProcessing = async (session: UploadSession) => {
    let current = session;
    while (current.status === 'assembling' || current.status === 'processing') {
      report('processing', totalBytes);
      await sleep(pollIntervalMs, signal);
      current = await withRetry(() => transport.getSession(session.uploadId));
      onSession?.(current);
    }
    return current;
  };

  report('preparing', 0);
  let session = await resumeOrCreate();
  resumeStore?.set(key, session.uploadId);
  onSession?.(session);

  for (let round = 0; round < MAX_COMPLETE_ROUNDS; round++) {
    if (session.status === 'uploading') {
      await uploadMissing(session);
    }
    if (
      session.status === 'uploading' ||
      (session.status === 'failed' && session.retryable)
    ) {
      try {
        session = await withRetry(() => transport.complete(session.uploadId));
      } catch (error) {
        // Chunks missing (e.g. a lost response): refresh and upload them.
        if (error instanceof UploadRequestError && error.status === 409) {
          session = await withRetry(() =>
            transport.getSession(session.uploadId)
          );
          continue;
        }
        throw error;
      }
      onSession?.(session);
    }
    session = await waitWhileProcessing(session);

    if (session.status === 'completed') {
      resumeStore?.remove(key);
      report('completed', totalBytes);
      return session;
    }
    if (session.status === 'failed') {
      if (!session.retryable) resumeStore?.remove(key);
      throw new UploadRequestError(
        session.error?.message ?? 'The archive could not be imported.',
        422,
        session.error?.code,
        session.retryable
      );
    }
    // Back to "uploading": the server asks for damaged chunks again.
  }
  throw new UploadRequestError(
    'The upload could not be completed. Please retry.',
    0,
    undefined,
    true
  );
}
