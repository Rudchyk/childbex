export type ArchiveErrorCode =
  | 'UNSUPPORTED_FORMAT'
  | 'FORMAT_MISMATCH'
  | 'CORRUPT_ARCHIVE'
  | 'UPLOAD_TOO_LARGE'
  | 'LIMIT_EXCEEDED'
  | 'UNSAFE_ENTRY'
  | 'NO_USABLE_DICOM'
  | 'EXTRACTION_FAILED'
  /** A study UID of the archive is stored for another patient. */
  | 'STUDY_BELONGS_TO_ANOTHER_PATIENT'
  /** A series UID of the archive belongs to another study. */
  | 'SERIES_BELONGS_TO_ANOTHER_STUDY'
  /** A SOP instance UID is stored with other (or unverified) content. */
  | 'SOP_INSTANCE_CONTENT_CONFLICT'
  /** A SOP instance UID is stored for another patient. */
  | 'SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT'
  /** A SOP instance UID is stored in another study or series. */
  | 'SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES';

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
