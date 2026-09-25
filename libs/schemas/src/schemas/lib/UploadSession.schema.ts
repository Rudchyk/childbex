import { Type, type Static } from '@sinclair/typebox';

export enum UploadSessionStatus {
  /** Accepting chunks. */
  UPLOADING = 'uploading',
  /** All chunks received; the archive is being assembled. */
  ASSEMBLING = 'assembling',
  /** The assembled archive is being validated and imported. */
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export const ClientFingerprintSchema = Type.String({
  pattern: '^[A-Za-z0-9_-]{16,128}$',
});

export const CreateUploadSessionRequestBodySchema = Type.Object(
  {
    /** Used only to determine the archive type; never stored. */
    fileName: Type.String({ minLength: 1, maxLength: 255 }),
    /** The size limit is enforced by the server (413 with a clear message). */
    fileSize: Type.Integer({ minimum: 1 }),
    /**
     * Opaque client-provided identifier used to find the session again for
     * resuming (e.g. after a page reload). Not interpreted by the server;
     * never trusted alone for matching.
     */
    clientFingerprint: Type.Optional(ClientFingerprintSchema),
  },
  { additionalProperties: false }
);

export type CreateUploadSessionRequestBody = Static<
  typeof CreateUploadSessionRequestBodySchema
>;

export const UploadSessionParamsSchema = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
});

export type UploadSessionParams = Static<typeof UploadSessionParamsSchema>;

export const UploadSessionChunkParamsSchema = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
  index: Type.String({ pattern: '^(0|[1-9][0-9]{0,5})$' }),
});

export type UploadSessionChunkParams = Static<
  typeof UploadSessionChunkParamsSchema
>;

export const UploadSessionResultSchema = Type.Object({
  importedImages: Type.Integer(),
  alreadyImported: Type.Integer(),
  clusters: Type.Integer(),
  brokenImages: Type.Integer(),
  skippedFiles: Type.Integer(),
});

export type UploadSessionResult = Static<typeof UploadSessionResultSchema>;

export const UploadSessionSchema = Type.Object({
  uploadId: Type.String({ format: 'uuid' }),
  patientId: Type.String({ format: 'uuid' }),
  status: Type.Enum(UploadSessionStatus),
  fileSize: Type.Integer(),
  /** Allowlisted archive extension, e.g. `.tar.gz`. */
  extension: Type.String(),
  clientFingerprint: Type.Optional(ClientFingerprintSchema),
  chunkSize: Type.Integer(),
  totalChunks: Type.Integer(),
  receivedChunks: Type.Array(Type.Integer()),
  missingChunks: Type.Array(Type.Integer()),
  expiresAt: Type.String({ format: 'date-time' }),
  /** For failed sessions: whether `complete` may be retried without re-uploading. */
  retryable: Type.Boolean(),
  error: Type.Optional(
    Type.Object({ code: Type.String(), message: Type.String() })
  ),
  result: Type.Optional(UploadSessionResultSchema),
});

export type UploadSession = Static<typeof UploadSessionSchema>;
