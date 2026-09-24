import { HTTPError } from 'fets';
import type { ArchiveError } from '../../../services/archive/archive.errors';

export const getSecurityServiceUnavailableError = () =>
  new HTTPError(
    503,
    'Service Unavailable',
    {},
    {
      message: 'Security service is not initialized',
    }
  );

export const getUnauthorizedError = () =>
  new HTTPError(
    401,
    'Unauthorized',
    {},
    {
      message: 'Authorization Required',
    }
  );

export const getNotFoundError = (name?: string) =>
  new HTTPError(
    404,
    'Not found',
    {},
    {
      message: `Not found. This ${name ?? 'resource'} does not exist.`,
    }
  );

export const getInternalServerRequestError = (msg?: string) =>
  new HTTPError(
    500,
    'Internal Server Error',
    {},
    {
      message: msg ?? 'Internal Server Error',
    }
  );

export const getPayloadTooLargeError = (msg?: string, code?: string) =>
  new HTTPError(
    413,
    'Payload Too Large',
    {},
    {
      message: msg ?? 'The request payload is too large.',
      code,
    }
  );

/** Maps an archive validation error to a client-safe HTTP error. */
export const getArchiveHttpError = (error: ArchiveError) => {
  const details = { message: error.message, code: error.code };
  switch (error.code) {
    case 'UPLOAD_TOO_LARGE':
    case 'LIMIT_EXCEEDED':
      return getPayloadTooLargeError(error.message, error.code);
    case 'EXTRACTION_FAILED':
      return new HTTPError(500, 'Internal Server Error', {}, details);
    default:
      return new HTTPError(400, 'Invalid request', {}, details);
  }
};

export const getInvalidRequestError = (msg?: string) =>
  new HTTPError(
    400,
    'Invalid request',
    {},
    {
      message:
        msg ??
        'Invalid request. The request parameters are incorrect or missing.',
    }
  );
