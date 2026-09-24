/**
 * Maximum size of a single uploaded study archive (the assembled file of a
 * chunked upload session).
 */
export const ARCHIVE_MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MiB

/**
 * Archive file extensions accepted for study upload (lower case).
 * The server additionally validates the archive content signature.
 */
export const ARCHIVE_EXTENSIONS = [
  '.zip',
  '.tar',
  '.tar.gz',
  '.tgz',
  '.tar.bz2',
  '.tbz2',
  '.tar.xz',
  '.txz',
] as const;

export type ArchiveExtension = (typeof ARCHIVE_EXTENSIONS)[number];

/** Chunked upload: total chunk count of the session (must match the server). */
export const UPLOAD_CHUNK_COUNT_HEADER = 'x-chunk-count';

/** Chunked upload: hex SHA-256 of the chunk body (required). */
export const UPLOAD_CHUNK_SHA256_HEADER = 'x-chunk-sha256';
