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
