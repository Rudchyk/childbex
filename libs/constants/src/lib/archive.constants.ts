/**
 * Maximum size of a single uploaded study archive.
 * The current multipart parser keeps the whole upload in memory, so this
 * limit must stay conservative until chunked/resumable upload is implemented.
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
