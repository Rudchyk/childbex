import type {
  BaseQueryFn,
  FetchArgs,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';

/** The part of keycloak-js used for API authentication. */
export interface TokenSource {
  token?: string;
  /** Refreshes when the token expires within `minValidity` s; -1 forces. */
  updateToken(minValidity: number): Promise<boolean>;
}

/** Tokens sent to the API stay valid at least this long (clock skew, latency). */
export const MIN_TOKEN_VALIDITY_SECONDS = 30;

/**
 * Proactively refreshes a token that is about to expire. Failures are left
 * to the 401 handling below (and to keycloak-js, which clears the token and
 * signals logout when the refresh token itself is rejected).
 */
export const ensureFreshToken = async (
  auth: TokenSource | undefined,
  minValidity = MIN_TOKEN_VALIDITY_SECONDS
) => {
  if (!auth?.token) return;
  try {
    await auth.updateToken(minValidity);
  } catch {
    // Handled when the API answers 401.
  }
};

export interface TokenRefresher {
  /**
   * Called after the API rejected `tokenUsed` with 401. Resolves `true` when
   * a new token is available (the request may be retried once). Concurrent
   * callers share a single refresh; a failed refresh ends the session once.
   */
  recover(tokenUsed: string | undefined): Promise<boolean>;
}

export const createTokenRefresher = (
  getAuth: () => TokenSource | undefined,
  onSessionExpired: () => void
): TokenRefresher => {
  let inFlight: Promise<boolean> | undefined;
  let expiredNotified = false;

  const refresh = async () => {
    const auth = getAuth();
    if (!auth) return false;
    try {
      // Forced: the server rejected the token even if the client
      // considers it valid (e.g. clock difference).
      await auth.updateToken(-1);
      return !!auth.token;
    } catch {
      return false;
    }
  };

  return {
    async recover(tokenUsed) {
      const current = getAuth()?.token;
      // Another request already refreshed the token meanwhile.
      if (current && current !== tokenUsed) return true;

      inFlight ??= refresh().finally(() => {
        inFlight = undefined;
      });
      const ok = await inFlight;
      if (ok) {
        expiredNotified = false;
      } else if (!expiredNotified) {
        expiredNotified = true;
        onSessionExpired();
      }
      return ok;
    },
  };
};

type ApiBaseQuery = BaseQueryFn<
  string | FetchArgs,
  unknown,
  FetchBaseQueryError
>;

/**
 * Wraps a base query: refreshes a token about to expire before sending, and
 * on 401 refreshes once and retries the original request once. A second 401,
 * network errors and failed refreshes are returned to the caller as they are
 * (no reloads, no redirect loops).
 */
export const createReauthBaseQuery = (
  baseQuery: ApiBaseQuery,
  {
    getAuth,
    refresher,
  }: {
    getAuth: () => TokenSource | undefined;
    refresher: TokenRefresher;
  }
): ApiBaseQuery => {
  return async (args, api, extraOptions) => {
    await ensureFreshToken(getAuth());
    // The token the request is sent with (prepareHeaders reads the same).
    const tokenUsed = getAuth()?.token;
    const result = await baseQuery(args, api, extraOptions);
    if (result.error?.status !== 401) return result;
    if (!(await refresher.recover(tokenUsed))) return result;
    return baseQuery(args, api, extraOptions);
  };
};

/** Ends the session so the existing sign-in flow (ProtectedRoute) redirects. */
const endSession = () => window.keycloak?.clearToken();

/** Application-wide refresher for the keycloak-js instance. */
export const keycloakRefresher = createTokenRefresher(
  () => window.keycloak,
  endSession
);
