export type ArchiveErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FORMAT_MISMATCH'
  | 'CORRUPT_ARCHIVE'
  | 'UPLOAD_TOO_LARGE'
  | 'LIMIT_EXCEEDED'
  | 'UNSAFE_ENTRY'
  | 'NO_USABLE_DICOM'
  | 'EXTRACTION_FAILED';

/**
 * Error raised while validating/extracting an uploaded archive.
 * `message` is safe to return to the client: it must never contain server
 * paths or archive entry names (entry names may contain patient data).
 */
export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ArchiveError';
  }
}

export const isArchiveError = (error: unknown): error is ArchiveError =>
  error instanceof ArchiveError;
