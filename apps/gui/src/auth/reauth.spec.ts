/**
 * @jest-environment node
 */
import type {
  BaseQueryApi,
  FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import {
  createReauthBaseQuery,
  createTokenRefresher,
  keycloakRefresher,
  type TokenSource,
} from './reauth';

/** Minimal stand-in for keycloak-js token handling. */
class FakeKeycloak implements TokenSource {
  token: string | undefined = 'token-1';
  /** Seconds until the current token expires (client's view). */
  expiresIn = 300;
  refreshCalls = 0;
  failRefresh = false;
  clearToken = jest.fn(() => {
    this.token = undefined;
  });
  private generation = 1;

  async updateToken(minValidity: number) {
    if (minValidity !== -1 && this.expiresIn > minValidity) return false;
    this.refreshCalls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.failRefresh || !this.token) {
      // keycloak-js clears the token when the refresh token is rejected.
      this.token = undefined;
      throw new Error('Server responded with an invalid status.');
    }
    this.token = `token-${++this.generation}`;
    this.expiresIn = 300;
    return true;
  }
}

type Result =
  | { data: unknown; error?: undefined }
  | { error: FetchBaseQueryError; data?: undefined };

/** Fake API: records the token of every request, rejects listed tokens. */
const createApi = (keycloak: FakeKeycloak) => {
  const sentTokens: (string | undefined)[] = [];
  const rejected = new Set<string | undefined>();
  let networkDown = false;
  const baseQuery = jest.fn(async (): Promise<Result> => {
    const token = keycloak.token; // what prepareHeaders would send
    sentTokens.push(token);
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (networkDown) {
      return { error: { status: 'FETCH_ERROR', error: 'TypeError' } };
    }
    if (!token || rejected.has(token)) {
      return { error: { status: 401, data: { code: 'UNAUTHENTICATED' } } };
    }
    return { data: { ok: true, token } };
  });
  return {
    baseQuery,
    sentTokens,
    rejected,
    setNetworkDown: (down: boolean) => (networkDown = down),
  };
};

const api = {} as BaseQueryApi;

let keycloak: FakeKeycloak;
let server: ReturnType<typeof createApi>;
let onSessionExpired: jest.Mock;
let query: ReturnType<typeof createReauthBaseQuery>;
let reload: jest.Mock;

beforeEach(() => {
  keycloak = new FakeKeycloak();
  server = createApi(keycloak);
  onSessionExpired = jest.fn();
  reload = jest.fn();
  (globalThis as unknown as { window: unknown }).window = {
    location: { reload },
  };
  query = createReauthBaseQuery(server.baseQuery, {
    getAuth: () => keycloak,
    refresher: createTokenRefresher(() => keycloak, onSessionExpired),
  });
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const call = () => query('/patients', api, {});

describe('API re-authentication', () => {
  it('refreshes a token that is about to expire once, before sending', async () => {
    keycloak.expiresIn = 10; // below the 30 s minimum validity
    const result = await call();
    expect(keycloak.refreshCalls).toBe(1);
    expect(server.sentTokens).toEqual(['token-2']);
    expect(result).toEqual({ data: { ok: true, token: 'token-2' } });
  });

  it('on 401 refreshes once and retries the original request with the new token', async () => {
    // The client still considers token-1 valid (e.g. clock difference),
    // but the server rejects it.
    server.rejected.add('token-1');
    const result = await call();
    expect(keycloak.refreshCalls).toBe(1);
    expect(server.baseQuery).toHaveBeenCalledTimes(2);
    expect(server.sentTokens).toEqual(['token-1', 'token-2']);
    expect(result).toEqual({ data: { ok: true, token: 'token-2' } });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('shares one refresh between concurrent requests rejected with the same token', async () => {
    server.rejected.add('token-1');
    const results = await Promise.all([call(), call(), call()]);
    expect(keycloak.refreshCalls).toBe(1);
    results.forEach((result) =>
      expect(result).toEqual({ data: { ok: true, token: 'token-2' } })
    );
  });

  it('does not refresh again for a request rejected with an already replaced token', async () => {
    server.rejected.add('token-1');
    await call(); // refreshes to token-2
    const refresher = createTokenRefresher(() => keycloak, onSessionExpired);
    await expect(refresher.recover('token-1')).resolves.toBe(true);
    expect(keycloak.refreshCalls).toBe(1);
  });

  it('handles a failed refresh explicitly: no retry, session ends once, no reload', async () => {
    server.rejected.add('token-1');
    keycloak.failRefresh = true;
    const results = await Promise.all([call(), call()]);
    results.forEach((result) =>
      expect(result.error).toMatchObject({ status: 401 })
    );
    expect(keycloak.refreshCalls).toBe(1);
    expect(server.baseQuery).toHaveBeenCalledTimes(2); // no retries
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not loop when the retried request is rejected again', async () => {
    server.rejected.add('token-1');
    server.rejected.add('token-2');
    const result = await call();
    expect(result.error).toMatchObject({ status: 401 });
    expect(keycloak.refreshCalls).toBe(1);
    expect(server.baseQuery).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('ends the session when there is no token to refresh', async () => {
    keycloak.token = undefined;
    const result = await call();
    expect(server.sentTokens).toEqual([undefined]);
    expect(result.error).toMatchObject({ status: 401 });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('returns network errors as they are, without refresh or reload', async () => {
    server.setNetworkDown(true);
    const result = await call();
    expect(result.error).toMatchObject({ status: 'FETCH_ERROR' });
    expect(keycloak.refreshCalls).toBe(0);
    expect(onSessionExpired).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('the application refresher ends the keycloak session so sign-in takes over', async () => {
    keycloak.failRefresh = true;
    (window as unknown as { keycloak: FakeKeycloak }).keycloak = keycloak;
    await expect(keycloakRefresher.recover('token-1')).resolves.toBe(false);
    expect(keycloak.clearToken).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });
});
