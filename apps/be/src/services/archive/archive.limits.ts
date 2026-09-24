import { ARCHIVE_MAX_UPLOAD_BYTES } from '@libs/constants';

export interface ArchiveLimits {
  /** Maximum size of the uploaded (compressed) archive. */
  maxUploadBytes: number;
  /** Maximum total size of all extracted files. */
  maxExtractedBytes: number;
  /** Maximum size of a single extracted file. */
  maxEntryBytes: number;
  /** Maximum number of archive entries (files, directories, links). */
  maxEntries: number;
  /** Maximum number of path segments of an archive entry. */
  maxPathDepth: number;
  /** Maximum length of an archive entry path (characters). */
  maxPathLength: number;
  /** Maximum duration of the extraction step. */
  timeoutMs: number;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export const defaultArchiveLimits: Readonly<ArchiveLimits> = Object.freeze({
  maxUploadBytes: ARCHIVE_MAX_UPLOAD_BYTES,
  maxExtractedBytes: 4 * GiB,
  maxEntryBytes: 1 * GiB,
  maxEntries: 50_000,
  maxPathDepth: 32,
  maxPathLength: 1024,
  timeoutMs: 15 * 60 * 1000,
});

const envNames: Record<keyof ArchiveLimits, string> = {
  maxUploadBytes: 'ARCHIVE_MAX_UPLOAD_BYTES',
  maxExtractedBytes: 'ARCHIVE_MAX_EXTRACTED_BYTES',
  maxEntryBytes: 'ARCHIVE_MAX_ENTRY_BYTES',
  maxEntries: 'ARCHIVE_MAX_ENTRIES',
  maxPathDepth: 'ARCHIVE_MAX_PATH_DEPTH',
  maxPathLength: 'ARCHIVE_MAX_PATH_LENGTH',
  timeoutMs: 'ARCHIVE_EXTRACTION_TIMEOUT_MS',
};

/**
 * Reads archive limits from environment variables, falling back to defaults.
 * Throws on invalid values so misconfiguration is detected at startup.
 */
export const readArchiveLimits = (
  env: NodeJS.ProcessEnv = process.env
): ArchiveLimits => {
  const limits = { ...defaultArchiveLimits };
  for (const key of Object.keys(envNames) as (keyof ArchiveLimits)[]) {
    const raw = env[envNames[key]];
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(
        `Invalid ${envNames[key]}: expected a positive integer, got "${raw}"`
      );
    }
    limits[key] = value;
  }
  if (limits.maxUploadBytes > ARCHIVE_MAX_UPLOAD_BYTES) {
    // The upload is still buffered in memory by the multipart parser and the
    // GUI enforces the same shared limit; raising it needs chunked upload.
    throw new Error(
      `${envNames.maxUploadBytes} must not exceed ${ARCHIVE_MAX_UPLOAD_BYTES}`
    );
  }
  return limits;
};

export const archiveLimits: Readonly<ArchiveLimits> = Object.freeze(
  readArchiveLimits()
);
