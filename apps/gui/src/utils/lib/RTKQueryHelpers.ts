import { FetchBaseQueryError } from '@reduxjs/toolkit/query';

/**
 * Type predicate to narrow an unknown error to `FetchBaseQueryError`
 */
export function isFetchBaseQueryError(
  error: unknown
): error is FetchBaseQueryError {
  return typeof error === 'object' && error != null && 'status' in error;
}

/**
 * Type predicate to narrow an unknown error to an object with a string 'message' property
 */
export function isErrorWithMessage(
  error: unknown
): error is { message: string } {
  return (
    typeof error === 'object' &&
    error != null &&
    'message' in error &&
    typeof (error as Error).message === 'string'
  );
}

export const getErrorMessage = (err: unknown): string => {
  if (isFetchBaseQueryError(err)) {
    if ('error' in err) {
      return err.error;
    }
    if ('data' in err) {
      const errData = err.data as Error;
      return errData?.message || JSON.stringify(err.data);
    }
  } else if (isErrorWithMessage(err)) {
    return err.message;
  }
  return '';
};
