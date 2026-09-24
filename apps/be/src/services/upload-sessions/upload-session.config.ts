import { tmpdir } from 'node:os';
import path from 'node:path';
import { archiveLimits } from '../archive/archive.limits';

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const HOUR = 60 * 60 * 1000;

/** Allowed range for the server-selected chunk size. */
export const MIN_CHUNK_SIZE_BYTES = 8 * MiB;
export const MAX_CHUNK_SIZE_BYTES = 50 * MiB;

export interface UploadSessionConfig {
  /** Private directory for session state and chunks (never served). */
  rootDir: string;
  /** Size of every chunk except the last one. */
  chunkSizeBytes: number;
  /** Maximum size of the assembled archive. */
  maxFileBytes: number;
  /** Maximum number of unfinished sessions per user. */
  maxActiveSessionsPerUser: number;
  /** Maximum total declared size of all unfinished sessions. */
  maxActiveBytesTotal: number;
  /** Inactivity period after which an unfinished session is deleted. */
  sessionTtlMs: number;
  /** How long the status of a finished session remains readable. */
  finishedRetentionMs: number;
  /** Age after which leftover partial chunk files are deleted. */
  incomingMaxAgeMs: number;
  /** Interval of the cleanup job. */
  cleanupIntervalMs: number;
  /** Maximum number of chunk bodies written in parallel per session. */
  maxConcurrentChunkWrites: number;
  /** Free space that must remain on the disk in addition to the upload. */
  minFreeDiskBytes: number;
}

export const defaultUploadSessionConfig = (): UploadSessionConfig => ({
  rootDir: path.join(tmpdir(), 'childbex-upload-sessions'),
  chunkSizeBytes: 32 * MiB,
  maxFileBytes: archiveLimits.maxUploadBytes,
  maxActiveSessionsPerUser: 3,
  maxActiveBytesTotal: 5 * GiB,
  sessionTtlMs: 24 * HOUR,
  finishedRetentionMs: 1 * HOUR,
  incomingMaxAgeMs: 1 * HOUR,
  cleanupIntervalMs: 15 * 60 * 1000,
  maxConcurrentChunkWrites: 4,
  minFreeDiskBytes: 512 * MiB,
});

const positiveInt = (name: string, raw: string) => {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive integer, got "${raw}"`
    );
  }
  return value;
};

/**
 * Reads the upload session configuration from environment variables.
 * Throws on invalid values so misconfiguration is detected at startup.
 */
export const readUploadSessionConfig = (
  env: NodeJS.ProcessEnv = process.env
): UploadSessionConfig => {
  const config = defaultUploadSessionConfig();
  if (env.UPLOAD_SESSIONS_DIR) {
    config.rootDir = path.resolve(env.UPLOAD_SESSIONS_DIR);
  }
  const numeric: [keyof UploadSessionConfig, string][] = [
    ['chunkSizeBytes', 'UPLOAD_CHUNK_SIZE_BYTES'],
    ['sessionTtlMs', 'UPLOAD_SESSION_TTL_MS'],
    ['maxActiveSessionsPerUser', 'UPLOAD_SESSIONS_MAX_PER_USER'],
    ['maxActiveBytesTotal', 'UPLOAD_SESSIONS_MAX_TOTAL_BYTES'],
  ];
  for (const [key, name] of numeric) {
    const raw = env[name];
    if (raw !== undefined && raw.trim() !== '') {
      (config[key] as number) = positiveInt(name, raw);
    }
  }
  if (
    config.chunkSizeBytes < MIN_CHUNK_SIZE_BYTES ||
    config.chunkSizeBytes > MAX_CHUNK_SIZE_BYTES
  ) {
    throw new Error(
      `UPLOAD_CHUNK_SIZE_BYTES must be between ${MIN_CHUNK_SIZE_BYTES} and ${MAX_CHUNK_SIZE_BYTES}`
    );
  }
  return config;
};
