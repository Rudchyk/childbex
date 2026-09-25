import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  statfs,
} from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveExtension } from '@libs/constants';
import {
  UploadSessionStatus,
  type UploadSession,
  type UploadSessionResult,
} from '@libs/schemas';
import { logger } from '../logger.service';
import { ArchiveError, isArchiveError } from '../archive/archive.errors';
import { requireAllowedExtension } from '../archive/archive.detect';
import type { UploadSessionConfig } from './upload-session.config';
import { UploadSessionError, sessionNotFound } from './upload-session.errors';
import {
  KeyedMutex,
  SessionPaths,
  isValidUploadId,
  readRecord,
  releaseLock,
  removeSessionDir,
  tryAcquireLock,
  writeRecord,
  type SessionRecord,
} from './upload-session.store';

export interface ImportArchiveRequest {
  uploadId: string;
  patientId: string;
  archivePath: string;
  extension: ArchiveExtension;
  size: number;
  sha256: string;
}

export interface UploadSessionDeps {
  /** Runs the existing archive validation/extraction/DICOM ingestion. */
  importArchive(request: ImportArchiveRequest): Promise<UploadSessionResult>;
  patientExists(patientId: string): Promise<boolean>;
  /** Publicly served directories; the session store must not be inside them. */
  publicRoots?: string[];
  now?: () => number;
}

export interface PutChunkInput {
  uploadId: string;
  ownerSub: string;
  index: string;
  chunkCount: string | null;
  sha256: string | null;
  contentLength: string | null;
  body: AsyncIterable<Uint8Array> | null;
}

const { UPLOADING, ASSEMBLING, PROCESSING, COMPLETED, FAILED } =
  UploadSessionStatus;

const SHA256_RX = /^[0-9a-f]{64}$/i;
const INDEX_RX = /^(0|[1-9][0-9]*)$/;
const CREATE_LOCK = '__create__';

const invalidChunk = (message: string) =>
  new UploadSessionError('INVALID_CHUNK', message);

/** A processing failure that retrying cannot fix. */
class PermanentUploadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Archive validation errors are permanent (the same bytes fail again);
 * server-side extraction failures (disk full, permissions) are retryable.
 */
const toPermanentError = (error: unknown) => {
  if (error instanceof PermanentUploadError) return error;
  if (isArchiveError(error) && error.code !== 'EXTRACTION_FAILED') {
    return new PermanentUploadError(error.code, error.message);
  }
  return null;
};

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false
  );

/** Maps "disk full" to a client-facing error; rethrows everything else. */
const rethrowStorageError = (error: unknown): never => {
  if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') {
    throw new UploadSessionError(
      'INSUFFICIENT_STORAGE',
      'The server is out of storage for uploads. Please try again later.'
    );
  }
  throw error;
};

/**
 * Chunked, resumable archive uploads. Session state lives on the file system
 * (single backend instance); in-process locks serialise state changes.
 * After all chunks are assembled, the archive is handed to the existing
 * ingestion pipeline (`deps.importArchive`), which performs all archive
 * validation and extraction security checks.
 */
export class UploadSessionService {
  private readonly paths: SessionPaths;
  private readonly mutex = new KeyedMutex();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly chunkWrites = new Map<string, number>();
  private readonly incomingFiles = new Set<string>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: UploadSessionConfig,
    private readonly deps: UploadSessionDeps
  ) {
    this.paths = new SessionPaths(config.rootDir);
  }

  private now() {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /** Prepares the store and recovers sessions interrupted by a restart. */
  async init() {
    const root = this.config.rootDir;
    if ((this.deps.publicRoots ?? []).some((pub) => isInside(root, pub))) {
      throw new Error(
        'UPLOAD_SESSIONS_DIR must not be inside a publicly served directory'
      );
    }
    await mkdir(root, { recursive: true, mode: 0o700 });
    await this.cleanup();
  }

  startCleanupTimer() {
    this.stopCleanupTimer();
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((error) =>
        logger.error(error, 'upload session cleanup failed')
      );
    }, this.config.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }

  stopCleanupTimer() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  /** Resolves when all background assembly/import jobs have finished. */
  async whenIdle() {
    while (this.jobs.size) {
      await Promise.allSettled([...this.jobs.values()]);
    }
  }

  // ------------------------------------------------------------- views ---

  private expectedChunkSize(record: SessionRecord, index: number) {
    return index < record.totalChunks - 1
      ? record.chunkSize
      : record.fileSize - record.chunkSize * (record.totalChunks - 1);
  }

  private toView(record: SessionRecord): UploadSession {
    const received = Object.keys(record.chunks)
      .map(Number)
      .sort((a, b) => a - b);
    const receivedSet = new Set(received);
    const missing: number[] = [];
    for (let i = 0; i < record.totalChunks; i++) {
      if (!receivedSet.has(i)) missing.push(i);
    }
    return {
      uploadId: record.uploadId,
      patientId: record.patientId,
      status: record.status,
      fileSize: record.fileSize,
      chunkSize: record.chunkSize,
      totalChunks: record.totalChunks,
      receivedChunks: received,
      missingChunks: missing,
      expiresAt: record.expiresAt,
      retryable: record.retryable,
      ...(record.error ? { error: record.error } : {}),
      ...(record.result ? { result: record.result } : {}),
    };
  }

  private touch(record: SessionRecord, ttlMs = this.config.sessionTtlMs) {
    const now = this.now();
    record.updatedAt = new Date(now).toISOString();
    record.expiresAt = new Date(now + ttlMs).toISOString();
  }

  private isExpired(record: SessionRecord) {
    return (
      record.status !== ASSEMBLING &&
      record.status !== PROCESSING &&
      this.now() > Date.parse(record.expiresAt)
    );
  }

  /** Loads a session of the given owner; anything else is "not found". */
  private async loadOwned(uploadId: string, ownerSub: string) {
    if (!isValidUploadId(uploadId)) throw sessionNotFound();
    const record = await readRecord(this.paths, uploadId);
    if (!record || record.ownerSub !== ownerSub || this.isExpired(record)) {
      throw sessionNotFound();
    }
    return record;
  }

  private async listRecords(): Promise<SessionRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.config.rootDir);
    } catch {
      return [];
    }
    const records = await Promise.all(
      names.filter(isValidUploadId).map((id) => readRecord(this.paths, id))
    );
    return records.filter((r): r is SessionRecord => !!r);
  }

  private holdsStorage(record: SessionRecord) {
    return (
      !this.isExpired(record) &&
      (record.status === UPLOADING ||
        record.status === ASSEMBLING ||
        record.status === PROCESSING ||
        (record.status === FAILED && record.retryable))
    );
  }

  // ------------------------------------------------------------ create ---

  async create(input: {
    patientId: string;
    ownerSub: string;
    fileName: string;
    fileSize: number;
  }): Promise<UploadSession> {
    const extension = requireAllowedExtension(input.fileName);
    const { fileSize } = input;
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      throw new ArchiveError('CORRUPT_ARCHIVE', 'The archive is empty.');
    }
    if (fileSize > this.config.maxFileBytes) {
      throw new ArchiveError(
        'UPLOAD_TOO_LARGE',
        `The archive exceeds the maximum upload size of ${Math.floor(
          this.config.maxFileBytes / 1024 / 1024
        )} MB.`
      );
    }

    return this.mutex.run(CREATE_LOCK, async () => {
      const active = (await this.listRecords()).filter((r) =>
        this.holdsStorage(r)
      );
      if (
        active.filter((r) => r.ownerSub === input.ownerSub).length >=
        this.config.maxActiveSessionsPerUser
      ) {
        throw new UploadSessionError(
          'TOO_MANY_SESSIONS',
          'Too many unfinished uploads. Finish or cancel an existing upload first.'
        );
      }
      const reserved = active.reduce((sum, r) => sum + r.fileSize, 0);
      if (reserved + fileSize > this.config.maxActiveBytesTotal) {
        throw new UploadSessionError(
          'INSUFFICIENT_STORAGE',
          'The server is busy with other uploads. Please try again later.'
        );
      }
      await this.ensureFreeSpace(fileSize);

      const chunkSize = this.config.chunkSizeBytes;
      const uploadId = randomUUID();
      const now = new Date(this.now()).toISOString();
      const record: SessionRecord = {
        version: 1,
        uploadId,
        patientId: input.patientId,
        ownerSub: input.ownerSub,
        extension,
        fileSize,
        chunkSize,
        totalChunks: Math.ceil(fileSize / chunkSize),
        status: UPLOADING,
        chunks: {},
        retryable: false,
        createdAt: now,
        updatedAt: now,
        expiresAt: now,
      };
      this.touch(record);
      try {
        await mkdir(this.paths.chunksDir(uploadId), {
          recursive: true,
          mode: 0o700,
        });
        await writeRecord(this.paths, record);
      } catch (error) {
        await removeSessionDir(this.paths, uploadId).catch(() => undefined);
        rethrowStorageError(error);
      }
      logger.info(
        {
          uploadId,
          patientId: record.patientId,
          fileSize,
          totalChunks: record.totalChunks,
        },
        'upload session created'
      );
      return this.toView(record);
    });
  }

  private async ensureFreeSpace(fileSize: number) {
    let available: number;
    try {
      const fs = await statfs(this.config.rootDir);
      available = Number(fs.bavail) * Number(fs.bsize);
    } catch {
      return; // statfs unsupported: rely on ENOSPC handling
    }
    // Chunks and the assembled archive briefly coexist during assembly.
    if (available < fileSize * 2 + this.config.minFreeDiskBytes) {
      throw new UploadSessionError(
        'INSUFFICIENT_STORAGE',
        'The server does not have enough free storage for this upload.'
      );
    }
  }

  // ------------------------------------------------------------ status ---

  async get(uploadId: string, ownerSub: string): Promise<UploadSession> {
    return this.toView(await this.loadOwned(uploadId, ownerSub));
  }

  // ------------------------------------------------------------- chunk ---

  /**
   * Stores one chunk. Returns `stored: false` for an idempotent duplicate
   * (same index and checksum); the caller must then discard the body.
   */
  async putChunk(
    input: PutChunkInput
  ): Promise<{ stored: boolean; session: UploadSession }> {
    const record = await this.loadOwned(input.uploadId, input.ownerSub);
    const uploadId = record.uploadId;

    if (
      !INDEX_RX.test(input.index) ||
      Number(input.index) >= record.totalChunks
    ) {
      throw invalidChunk('Chunk index is out of range.');
    }
    const index = Number(input.index);
    if (
      !input.chunkCount ||
      !INDEX_RX.test(input.chunkCount) ||
      Number(input.chunkCount) !== record.totalChunks
    ) {
      throw invalidChunk('Chunk count does not match the upload session.');
    }
    if (!input.sha256 || !SHA256_RX.test(input.sha256)) {
      throw invalidChunk('A valid chunk SHA-256 checksum is required.');
    }
    const sha256 = input.sha256.toLowerCase();
    if (!input.contentLength || !INDEX_RX.test(input.contentLength)) {
      throw new UploadSessionError(
        'LENGTH_REQUIRED',
        'The chunk size (Content-Length) is required.'
      );
    }
    const expectedSize = this.expectedChunkSize(record, index);
    const contentLength = Number(input.contentLength);
    if (contentLength > expectedSize) {
      throw new UploadSessionError(
        'CHUNK_TOO_LARGE',
        'The chunk is larger than expected.'
      );
    }
    if (contentLength !== expectedSize) {
      throw invalidChunk('The chunk has an unexpected size.');
    }
    if (record.status !== UPLOADING) {
      throw new UploadSessionError(
        'SESSION_NOT_UPLOADING',
        'The upload session no longer accepts chunks.'
      );
    }
    const existing = record.chunks[index];
    if (existing === sha256) {
      return { stored: false, session: this.toView(record) };
    }
    if (existing) {
      throw new UploadSessionError(
        'CHUNK_CONFLICT',
        'A different chunk with this index was already uploaded.'
      );
    }
    if (!input.body) throw invalidChunk('The chunk body is missing.');

    const writes = this.chunkWrites.get(uploadId) ?? 0;
    if (writes >= this.config.maxConcurrentChunkWrites) {
      throw new UploadSessionError(
        'TOO_MANY_REQUESTS',
        'Too many chunks are being uploaded in parallel.'
      );
    }
    this.chunkWrites.set(uploadId, writes + 1);

    const temp = this.paths.incoming(uploadId, index);
    this.incomingFiles.add(temp);
    try {
      await this.receiveBody(input.body, temp, expectedSize, sha256);
      return await this.mutex.run(uploadId, () =>
        this.commitChunk(uploadId, index, sha256, temp)
      );
    } catch (error) {
      return rethrowStorageError(error);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
      this.incomingFiles.delete(temp);
      const left = (this.chunkWrites.get(uploadId) ?? 1) - 1;
      if (left > 0) this.chunkWrites.set(uploadId, left);
      else this.chunkWrites.delete(uploadId);
    }
  }

  /** Streams the body to `temp`, enforcing the exact size and checksum. */
  private async receiveBody(
    body: AsyncIterable<Uint8Array>,
    temp: string,
    expectedSize: number,
    sha256: string
  ) {
    const hash = createHash('sha256');
    const handle = await open(temp, 'wx', 0o600);
    let size = 0;
    try {
      for await (const part of body) {
        size += part.byteLength;
        if (size > expectedSize) {
          throw new UploadSessionError(
            'CHUNK_TOO_LARGE',
            'The chunk is larger than expected.'
          );
        }
        hash.update(part);
        await handle.write(part);
      }
    } finally {
      await handle.close();
    }
    if (size !== expectedSize) {
      throw invalidChunk('The chunk upload was incomplete.');
    }
    if (hash.digest('hex') !== sha256) {
      throw new UploadSessionError(
        'CHUNK_CHECKSUM_MISMATCH',
        'The chunk checksum does not match its content.'
      );
    }
  }

  private async commitChunk(
    uploadId: string,
    index: number,
    sha256: string,
    temp: string
  ) {
    const record = await readRecord(this.paths, uploadId);
    if (!record) throw sessionNotFound();
    if (record.status !== UPLOADING) {
      throw new UploadSessionError(
        'SESSION_NOT_UPLOADING',
        'The upload session no longer accepts chunks.'
      );
    }
    const existing = record.chunks[index];
    if (existing === sha256)
      return { stored: false, session: this.toView(record) };
    if (existing) {
      throw new UploadSessionError(
        'CHUNK_CONFLICT',
        'A different chunk with this index was already uploaded.'
      );
    }
    const target = this.paths.chunk(uploadId, index);
    try {
      await link(temp, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A file not referenced by the record (e.g. crash before the record
      // was written) is stale; the record is the source of truth.
      await rm(target, { force: true });
      await link(temp, target);
    }
    record.chunks[index] = sha256;
    this.touch(record);
    await writeRecord(this.paths, record);
    return { stored: true, session: this.toView(record) };
  }

  // ---------------------------------------------------------- complete ---

  /**
   * Starts assembly + import in the background once all chunks are stored.
   * Idempotent: repeated calls return the current state.
   */
  async complete(uploadId: string, ownerSub: string): Promise<UploadSession> {
    await this.loadOwned(uploadId, ownerSub);
    return this.mutex.run(uploadId.toLowerCase(), async () => {
      const record = await this.loadOwned(uploadId, ownerSub);
      const id = record.uploadId;
      if (record.status === FAILED && !record.retryable) {
        return this.toView(record);
      }
      if (
        record.status === ASSEMBLING ||
        record.status === PROCESSING ||
        record.status === COMPLETED
      ) {
        return this.toView(record);
      }
      if (record.status === UPLOADING) {
        const { missingChunks } = this.toView(record);
        if (missingChunks.length) {
          throw new UploadSessionError(
            'CHUNKS_MISSING',
            'Not all chunks have been uploaded.',
            { missingChunks }
          );
        }
      }
      if (!(await tryAcquireLock(this.paths, id))) {
        return this.toView(record);
      }
      record.status = ASSEMBLING;
      record.retryable = false;
      delete record.error;
      this.touch(record);
      try {
        await writeRecord(this.paths, record);
      } catch (error) {
        await releaseLock(this.paths, id);
        throw error;
      }
      const job = this.runJob(id).finally(() => this.jobs.delete(id));
      this.jobs.set(id, job);
      return this.toView(record);
    });
  }

  private async update(
    uploadId: string,
    change: (record: SessionRecord) => void
  ): Promise<SessionRecord> {
    return this.mutex.run(uploadId, async () => {
      const record = await readRecord(this.paths, uploadId);
      if (!record) throw sessionNotFound();
      change(record);
      await writeRecord(this.paths, record);
      return record;
    });
  }

  private async deleteSessionData(uploadId: string) {
    await rm(this.paths.assembled(uploadId), { force: true });
    await rm(this.paths.assembling(uploadId), { force: true });
    await rm(this.paths.chunksDir(uploadId), { recursive: true, force: true });
  }

  private async runJob(uploadId: string) {
    const assembledPath = this.paths.assembled(uploadId);
    try {
      let record = await readRecord(this.paths, uploadId);
      if (!record) return;

      if (!(await exists(assembledPath)) || !record.sha256) {
        const assembly = await this.assemble(record);
        if (!assembly.ok) {
          // Chunks vanished or were damaged on disk: ask the client to
          // upload them again instead of failing the whole upload.
          await this.update(uploadId, (r) => {
            for (const bad of assembly.badChunks) delete r.chunks[bad];
            r.status = UPLOADING;
            r.error = {
              code: 'CHUNKS_MISSING',
              message:
                'Some chunks were missing or damaged on the server and must be uploaded again.',
            };
            this.touch(r);
          });
          logger.warn(
            { uploadId, badChunks: assembly.badChunks.length },
            'upload session chunks must be re-uploaded'
          );
          return;
        }
        await rm(this.paths.chunksDir(uploadId), {
          recursive: true,
          force: true,
        });
        record = await this.update(uploadId, (r) => {
          r.sha256 = assembly.sha256;
          r.status = PROCESSING;
          this.touch(r);
        });
      } else {
        record = await this.update(uploadId, (r) => {
          r.status = PROCESSING;
          this.touch(r);
        });
      }

      if (!(await this.deps.patientExists(record.patientId))) {
        throw new PermanentUploadError(
          'PATIENT_NOT_FOUND',
          'The patient for this upload no longer exists.'
        );
      }
      const result = await this.deps.importArchive({
        uploadId,
        patientId: record.patientId,
        archivePath: assembledPath,
        extension: record.extension,
        size: record.fileSize,
        sha256: record.sha256 as string,
      });
      await this.deleteSessionData(uploadId);
      await this.update(uploadId, (r) => {
        r.status = COMPLETED;
        r.result = result;
        r.retryable = false;
        delete r.error;
        this.touch(r, this.config.finishedRetentionMs);
      });
      logger.info({ uploadId, ...result }, 'upload session completed');
    } catch (error) {
      await this.failJob(uploadId, error);
    } finally {
      await releaseLock(this.paths, uploadId);
    }
  }

  private async failJob(uploadId: string, error: unknown) {
    const permanent = toPermanentError(error);
    if (permanent) {
      logger.warn(
        {
          uploadId,
          code: permanent.code,
          cause: isArchiveError(error) ? error.cause : undefined,
        },
        'upload session rejected'
      );
      await this.deleteSessionData(uploadId).catch(() => undefined);
    } else {
      logger.error(error, 'upload session processing failed');
    }
    await this.update(uploadId, (r) => {
      r.status = FAILED;
      r.retryable = !permanent;
      r.error = permanent
        ? { code: permanent.code, message: permanent.message }
        : {
            code: 'PROCESSING_FAILED',
            message:
              'The archive could not be processed because of a server error. Please retry.',
          };
      this.touch(
        r,
        permanent ? this.config.finishedRetentionMs : this.config.sessionTtlMs
      );
    }).catch((e) => logger.error(e, 'upload session state update failed'));
  }

  /** Concatenates chunks in index order, re-verifying every checksum. */
  private async assemble(
    record: SessionRecord
  ): Promise<
    { ok: true; sha256: string } | { ok: false; badChunks: number[] }
  > {
    const uploadId = record.uploadId;
    const temp = this.paths.assembling(uploadId);
    const whole = createHash('sha256');
    const badChunks: number[] = [];
    let total = 0;
    const handle = await open(temp, 'w', 0o600);
    try {
      for (let index = 0; index < record.totalChunks; index++) {
        const expected = record.chunks[index];
        if (!expected) {
          badChunks.push(index);
          continue;
        }
        const chunkHash = createHash('sha256');
        let size = 0;
        try {
          for await (const part of createReadStream(
            this.paths.chunk(uploadId, index)
          ) as AsyncIterable<Buffer>) {
            size += part.length;
            chunkHash.update(part);
            whole.update(part);
            await handle.write(part);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          badChunks.push(index);
          continue;
        }
        if (
          chunkHash.digest('hex') !== expected ||
          size !== this.expectedChunkSize(record, index)
        ) {
          badChunks.push(index);
        }
        total += size;
      }
    } finally {
      await handle.close();
    }
    if (badChunks.length || total !== record.fileSize) {
      await rm(temp, { force: true });
      return { ok: false, badChunks };
    }
    await rename(temp, this.paths.assembled(uploadId));
    return { ok: true, sha256: whole.digest('hex') };
  }

  // ------------------------------------------------------------ cancel ---

  async cancel(uploadId: string, ownerSub: string) {
    await this.loadOwned(uploadId, ownerSub);
    await this.mutex.run(uploadId.toLowerCase(), async () => {
      const record = await this.loadOwned(uploadId, ownerSub);
      if (
        record.status === ASSEMBLING ||
        record.status === PROCESSING ||
        this.jobs.has(record.uploadId)
      ) {
        throw new UploadSessionError(
          'SESSION_BUSY',
          'The archive is already being processed and cannot be cancelled.'
        );
      }
      await removeSessionDir(this.paths, record.uploadId);
      logger.info({ uploadId: record.uploadId }, 'upload session cancelled');
    });
  }

  /**
   * Removes all unfinished sessions of a patient (used when the patient is
   * trashed or deleted). Sessions being assembled/imported are left alone:
   * their import fails cleanly because the patient no longer exists.
   * Returns the number of removed sessions.
   */
  async cancelForPatient(patientId: string): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.config.rootDir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const uploadId of names.filter(isValidUploadId)) {
      await this.mutex.run(uploadId, async () => {
        const record = await readRecord(this.paths, uploadId);
        if (
          !record ||
          record.patientId !== patientId ||
          this.jobs.has(uploadId) ||
          record.status === ASSEMBLING ||
          record.status === PROCESSING
        ) {
          return;
        }
        await removeSessionDir(this.paths, uploadId);
        removed += 1;
      });
    }
    if (removed) {
      logger.info(
        { patientId, removed },
        'upload sessions removed for deleted patient'
      );
    }
    return removed;
  }

  // ----------------------------------------------------------- cleanup ---

  /**
   * Deletes expired/finished sessions and stale partial chunks, and recovers
   * sessions whose assembly/import was interrupted by a restart.
   */
  async cleanup() {
    let names: string[];
    try {
      names = await readdir(this.config.rootDir);
    } catch {
      return;
    }
    for (const name of names.filter(isValidUploadId)) {
      await this.mutex
        .run(name, () => this.cleanupSession(name))
        .catch((error) =>
          logger.error({ err: error, uploadId: name }, 'session cleanup failed')
        );
    }
  }

  private async cleanupSession(uploadId: string) {
    if (this.jobs.has(uploadId)) return;
    const dir = this.paths.dir(uploadId);
    const record = await readRecord(this.paths, uploadId);
    if (!record) {
      // Unreadable or half-created session directory.
      const info = await stat(dir).catch(() => null);
      if (info && this.now() - info.mtimeMs > this.config.sessionTtlMs) {
        await removeSessionDir(this.paths, uploadId);
      }
      return;
    }

    if (record.status === ASSEMBLING || record.status === PROCESSING) {
      // No job runs in this process: it was interrupted by a restart.
      await rm(this.paths.assembling(uploadId), { force: true });
      const assembled = await exists(this.paths.assembled(uploadId));
      if (assembled && record.sha256) {
        record.status = FAILED;
        record.retryable = true;
        record.error = {
          code: 'INTERRUPTED',
          message: 'Processing was interrupted. Please retry.',
        };
      } else {
        // Chunks are only deleted after a successful assembly.
        await rm(this.paths.assembled(uploadId), { force: true });
        record.status = UPLOADING;
      }
      this.touch(record);
      await writeRecord(this.paths, record);
      await releaseLock(this.paths, uploadId);
      logger.warn({ uploadId }, 'interrupted upload session recovered');
      return;
    }

    if (this.now() > Date.parse(record.expiresAt)) {
      await removeSessionDir(this.paths, uploadId);
      return;
    }

    if (record.status === UPLOADING) {
      const chunksDir = this.paths.chunksDir(uploadId);
      for (const file of await readdir(chunksDir).catch(() => [])) {
        const full = path.join(chunksDir, file);
        if (!file.startsWith('.incoming-') || this.incomingFiles.has(full)) {
          continue;
        }
        const info = await stat(full).catch(() => null);
        if (info && this.now() - info.mtimeMs > this.config.incomingMaxAgeMs) {
          await rm(full, { force: true });
        }
      }
    }
  }
}
