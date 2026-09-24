export type UploadSessionErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'INVALID_CHUNK'
  | 'CHUNK_CHECKSUM_MISMATCH'
  | 'CHUNK_CONFLICT'
  | 'SESSION_NOT_UPLOADING'
  | 'SESSION_BUSY'
  | 'CHUNKS_MISSING'
  | 'LENGTH_REQUIRED'
  | 'CHUNK_TOO_LARGE'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_SESSIONS'
  | 'TOO_MANY_REQUESTS'
  | 'INSUFFICIENT_STORAGE';

const statusByCode: Record<UploadSessionErrorCode, number> = {
  SESSION_NOT_FOUND: 404,
  INVALID_CHUNK: 400,
  CHUNK_CHECKSUM_MISMATCH: 400,
  CHUNK_CONFLICT: 409,
  SESSION_NOT_UPLOADING: 409,
  SESSION_BUSY: 409,
  CHUNKS_MISSING: 409,
  LENGTH_REQUIRED: 411,
  CHUNK_TOO_LARGE: 413,
  FILE_TOO_LARGE: 413,
  TOO_MANY_SESSIONS: 429,
  TOO_MANY_REQUESTS: 429,
  INSUFFICIENT_STORAGE: 507,
};

/**
 * Client-facing upload session error. `message` must never contain server
 * paths or file names.
 */
export class UploadSessionError extends Error {
  readonly status: number;

  constructor(
    readonly code: UploadSessionErrorCode,
    message: string,
    readonly details?: { missingChunks?: number[] }
  ) {
    super(message);
    this.name = 'UploadSessionError';
    this.status = statusByCode[code];
  }
}

export const isUploadSessionError = (
  error: unknown
): error is UploadSessionError => error instanceof UploadSessionError;

export const sessionNotFound = () =>
  new UploadSessionError('SESSION_NOT_FOUND', 'Upload session not found.');
