import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveExtension } from '@libs/constants';
import type { UploadSessionResult, UploadSessionStatus } from '@libs/schemas';

/** Persisted state of an upload session (`<root>/<uploadId>/session.json`). */
export interface SessionRecord {
  version: 1;
  uploadId: string;
  patientId: string;
  /** Keycloak subject of the user who created the session. */
  ownerSub: string;
  /** Allowlisted archive extension; the client file name is never stored. */
  extension: ArchiveExtension;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  status: UploadSessionStatus;
  /** Stored chunks: index -> hex SHA-256. */
  chunks: Record<string, string>;
  /** SHA-256 of the assembled archive. */
  sha256?: string;
  retryable: boolean;
  error?: { code: string; message: string };
  result?: UploadSessionResult;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUploadId = (value: string) => UUID_RX.test(value);

/** File system layout of the session store. */
export class SessionPaths {
  constructor(readonly rootDir: string) {}

  /** Throws for anything that is not a UUID, before it is used in a path. */
  dir(uploadId: string) {
    if (!isValidUploadId(uploadId)) throw new Error('Invalid upload id');
    return path.join(this.rootDir, uploadId.toLowerCase());
  }
  record(uploadId: string) {
    return path.join(this.dir(uploadId), 'session.json');
  }
  chunksDir(uploadId: string) {
    return path.join(this.dir(uploadId), 'chunks');
  }
  chunk(uploadId: string, index: number) {
    return path.join(
      this.chunksDir(uploadId),
      `${String(index).padStart(6, '0')}.chunk`
    );
  }
  incoming(uploadId: string, index: number) {
    return path.join(
      this.chunksDir(uploadId),
      `.incoming-${index}-${randomBytes(6).toString('hex')}`
    );
  }
  assembled(uploadId: string) {
    return path.join(this.dir(uploadId), 'assembled.bin');
  }
  assembling(uploadId: string) {
    return path.join(this.dir(uploadId), 'assembled.tmp');
  }
  lock(uploadId: string) {
    return path.join(this.dir(uploadId), 'assemble.lock');
  }
}

export const readRecord = async (
  paths: SessionPaths,
  uploadId: string
): Promise<SessionRecord | null> => {
  try {
    const record = JSON.parse(
      await readFile(paths.record(uploadId), 'utf8')
    ) as SessionRecord;
    return record.version === 1 && record.uploadId === uploadId.toLowerCase()
      ? record
      : null;
  } catch {
    return null;
  }
};

/** Atomic write: temp file + rename, so readers never see a partial record. */
export const writeRecord = async (
  paths: SessionPaths,
  record: SessionRecord
) => {
  const target = paths.record(record.uploadId);
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
};

export const removeSessionDir = (paths: SessionPaths, uploadId: string) =>
  rm(paths.dir(uploadId), {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });

/** Cross-request lock based on atomic directory creation. */
export const tryAcquireLock = async (paths: SessionPaths, uploadId: string) => {
  try {
    await mkdir(paths.lock(uploadId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
};

export const releaseLock = (paths: SessionPaths, uploadId: string) =>
  rmdir(paths.lock(uploadId)).catch(() => undefined);

/** Serialises async critical sections per key (single backend instance). */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
