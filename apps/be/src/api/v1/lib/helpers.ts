import { HTTPError } from 'fets';

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
