/**
 * @jest-environment node
 */
import { createHttpUploadTransport } from './httpTransport';
import { UploadRequestError } from './chunkedUpload';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

let token: string;
let fetchMock: jest.SpyInstance;

beforeEach(() => {
  token = 'token-1';
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => fetchMock.mockRestore());

const transport = (recoverAuth: (tokenUsed?: string) => Promise<boolean>) =>
  createHttpUploadTransport({
    baseUrl: 'http://api.test',
    authHeaders: async () => ({ authorization: `Bearer ${token}` }),
    recoverAuth,
  });

const sentAuthorization = (call: number) =>
  (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<
    string,
    string
  >;

describe('upload transport authentication', () => {
  it('refreshes once after a 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { code: 'UNAUTHENTICATED' }))
      .mockResolvedValueOnce(json(200, { uploadId: 'u1' }));
    const recoverAuth = jest.fn(async () => {
      token = 'token-2';
      return true;
    });

    await expect(transport(recoverAuth).getSession('u1')).resolves.toEqual({
      uploadId: 'u1',
    });
    expect(recoverAuth).toHaveBeenCalledTimes(1);
    expect(recoverAuth).toHaveBeenCalledWith('token-1');
    expect(sentAuthorization(0).authorization).toBe('Bearer token-1');
    expect(sentAuthorization(1).authorization).toBe('Bearer token-2');
  });

  it('reports an expired session without retrying when the refresh fails', async () => {
    fetchMock.mockImplementation(async () =>
      json(401, { code: 'UNAUTHENTICATED' })
    );
    const recoverAuth = jest.fn(async () => false);

    const promise = transport(recoverAuth).getSession('u1');
    await expect(promise).rejects.toBeInstanceOf(UploadRequestError);
    await expect(promise).rejects.toMatchObject({
      status: 401,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry more than once', async () => {
    fetchMock.mockImplementation(async () =>
      json(401, { code: 'UNAUTHENTICATED' })
    );
    const recoverAuth = jest.fn(async () => true);

    await expect(transport(recoverAuth).getSession('u1')).rejects.toMatchObject(
      { status: 401 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(recoverAuth).toHaveBeenCalledTimes(1);
  });
});
