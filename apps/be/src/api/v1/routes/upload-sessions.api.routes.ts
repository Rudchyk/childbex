import { Response } from 'fets';
import { router } from '../apiRouter';
import {
  apiRoutes,
  UPLOAD_CHUNK_COUNT_HEADER,
  UPLOAD_CHUNK_SHA256_HEADER,
} from '@libs/constants';
import { defaultResponses, unauthorizedResponse } from '../schemas/schemas';
import {
  CreateUploadSessionRequestBodySchema,
  IDPropertySchema,
  UploadSessionChunkParamsSchema,
  UploadSessionParamsSchema,
  UploadSessionSchema,
  Type,
  Value,
} from '@libs/schemas';
import {
  getKeycloakSecurity,
  getSecurityContentFromResponse,
} from '../lib/security.service';
import { Tags } from '../lib/tags.service';
import { Ctx } from '../lib/types';
import {
  getArchiveHttpError,
  getInternalServerRequestError,
  getInvalidRequestError,
  getNotFoundError,
  getUploadSessionHttpError,
} from '../lib/helpers';
import { Patient } from '../../../db/models/Patient.model';
import { isArchiveError } from '../../../services/archive/archive.errors';
import {
  isUploadSessionError,
  uploadSessionService,
} from '../../../services/upload-sessions';
import { logger } from '../../../services/logger.service';
import { MAX_CHUNK_SIZE_BYTES } from '../../../services/upload-sessions/upload-session.config';

const ownerOf = (ctx: unknown) =>
  getSecurityContentFromResponse(ctx as Ctx).sub as string;

/** Converts service errors into client-safe HTTP errors. */
const toHttpError = (error: unknown) => {
  if (isUploadSessionError(error)) return getUploadSessionHttpError(error);
  if (isArchiveError(error)) return getArchiveHttpError(error);
  // Already an HTTP error (e.g. 401 from the security helper).
  if (error && typeof error === 'object' && 'status' in error) return error;
  logger.error(error, 'upload session request failed');
  return getInternalServerRequestError('The upload request failed.');
};

/**
 * Reads and discards an unused request body so the response can be delivered
 * on an intact connection (cancelling the stream resets the socket and the
 * client never sees the response). Bounded: oversized bodies are abandoned.
 */
const discardBody = async (body: unknown) => {
  if (!body) return;
  let read = 0;
  try {
    for await (const part of body as AsyncIterable<Uint8Array>) {
      read += part.byteLength;
      if (read > MAX_CHUNK_SIZE_BYTES) break;
    }
  } catch {
    // The client went away; nothing left to deliver.
  }
};

const sessionResponses = {
  ...unauthorizedResponse,
  ...defaultResponses,
};

router
  // Create an upload session for a patient
  .route({
    description:
      'Create a chunked upload session for a study archive of a patient',
    method: 'POST',
    path: apiRoutes.patientUploadSessions,
    tags: [Tags.UPLOADS],
    ...getKeycloakSecurity(),
    schemas: {
      request: {
        params: IDPropertySchema,
        json: CreateUploadSessionRequestBodySchema,
      },
      responses: {
        201: UploadSessionSchema,
        ...sessionResponses,
      },
    },
    async handler(request, ctx) {
      try {
        const ownerSub = ownerOf(ctx);
        const { id } = request.params;
        const patient = await Patient.findByPk(id, { attributes: ['id'] });
        if (!patient) throw getNotFoundError('patient');
        const body = await request.json();
        // fets does not validate JSON bodies at runtime; do it explicitly.
        if (!Value.Check(CreateUploadSessionRequestBodySchema, body)) {
          throw getInvalidRequestError(
            'fileName (string) and fileSize (positive integer) are required.'
          );
        }
        const { fileName, fileSize, clientFingerprint } = body;
        const session = await uploadSessionService.create({
          patientId: patient.id,
          ownerSub,
          fileName,
          fileSize,
          clientFingerprint,
        });
        return Response.json(session, { status: 201 });
      } catch (error) {
        throw toHttpError(error);
      }
    },
  })
  // List the caller's unfinished upload sessions (to resume after reloads)
  .route({
    description:
      "List the caller's unfinished upload sessions (uploading, processing or retryable)",
    method: 'GET',
    path: apiRoutes.uploadSessions,
    tags: [Tags.UPLOADS],
    ...getKeycloakSecurity(),
    schemas: {
      responses: {
        200: Type.Array(UploadSessionSchema),
        ...sessionResponses,
      },
    },
    async handler(_request, ctx) {
      try {
        return Response.json(
          await uploadSessionService.listForOwner(ownerOf(ctx))
        );
      } catch (error) {
        throw toHttpError(error);
      }
    },
  })
  // Get upload session status (used to resume and to poll processing)
  .route({
    description:
      'Get the status of an upload session, including missing chunks',
    method: 'GET',
    path: apiRoutes.uploadSession,
    tags: [Tags.UPLOADS],
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: UploadSessionParamsSchema },
      responses: {
        200: UploadSessionSchema,
        ...sessionResponses,
      },
    },
    async handler(request, ctx) {
      try {
        const session = await uploadSessionService.get(
          request.params.uploadId,
          ownerOf(ctx)
        );
        return Response.json(session);
      } catch (error) {
        throw toHttpError(error);
      }
    },
  })
  // Upload one chunk (raw bytes)
  .route({
    description: `Upload one chunk as raw bytes. Headers: ${UPLOAD_CHUNK_COUNT_HEADER} (total chunks), ${UPLOAD_CHUNK_SHA256_HEADER} (hex SHA-256 of the chunk), Content-Length.`,
    method: 'PUT',
    path: apiRoutes.uploadSessionChunk,
    tags: [Tags.UPLOADS],
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: UploadSessionChunkParamsSchema },
      responses: {
        200: UploadSessionSchema,
        201: UploadSessionSchema,
        ...sessionResponses,
      },
    },
    async handler(request, ctx) {
      // Custom headers are not part of fets' typed header names.
      const headers = request.headers as unknown as Headers;
      try {
        const { stored, session } = await uploadSessionService.putChunk({
          uploadId: request.params.uploadId,
          ownerSub: ownerOf(ctx),
          index: request.params.index,
          chunkCount: headers.get(UPLOAD_CHUNK_COUNT_HEADER),
          sha256: headers.get(UPLOAD_CHUNK_SHA256_HEADER),
          contentLength: headers.get('content-length'),
          body: request.body as unknown as AsyncIterable<Uint8Array> | null,
        });
        if (stored) return Response.json(session, { status: 201 });
        // Idempotent duplicate: the body is not needed.
        await discardBody(request.body);
        return Response.json(session, { status: 200 });
      } catch (error) {
        // No-op if the body was already consumed.
        await discardBody(request.body);
        throw toHttpError(error);
      }
    },
  })
  // Finish the upload: assemble chunks and start the archive import
  .route({
    description:
      'Assemble all chunks and start validation/import of the archive (asynchronous; poll the session status)',
    method: 'POST',
    path: apiRoutes.uploadSessionComplete,
    tags: [Tags.UPLOADS],
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: UploadSessionParamsSchema },
      responses: {
        202: UploadSessionSchema,
        409: { description: 'Chunks are missing' },
        ...sessionResponses,
      },
    },
    async handler(request, ctx) {
      try {
        const session = await uploadSessionService.complete(
          request.params.uploadId,
          ownerOf(ctx)
        );
        return Response.json(session, { status: 202 });
      } catch (error) {
        throw toHttpError(error);
      }
    },
  })
  // Cancel an upload session
  .route({
    description: 'Cancel an upload session and delete its temporary data',
    method: 'DELETE',
    path: apiRoutes.uploadSession,
    tags: [Tags.UPLOADS],
    ...getKeycloakSecurity(),
    schemas: {
      request: { params: UploadSessionParamsSchema },
      responses: {
        204: { description: 'Cancelled' },
        409: { description: 'The archive is already being processed' },
        ...sessionResponses,
      },
    },
    async handler(request, ctx) {
      try {
        await uploadSessionService.cancel(
          request.params.uploadId,
          ownerOf(ctx)
        );
        return Response.json(null, { status: 204 });
      } catch (error) {
        throw toHttpError(error);
      }
    },
  });
