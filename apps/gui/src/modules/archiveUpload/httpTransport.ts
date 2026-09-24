import { generatePath } from 'react-router-dom';
import {
  apiRoutes,
  UPLOAD_CHUNK_COUNT_HEADER,
  UPLOAD_CHUNK_SHA256_HEADER,
} from '@libs/constants';
import type { UploadSession } from '@libs/schemas';
import {
  UploadRequestError,
  type ResumeStore,
  type UploadTransport,
} from './chunkedUpload';

type AuthHeaders = () => Promise<Record<string, string>>;

/** Refreshes the Keycloak token if needed (uploads can take minutes). */
export const keycloakAuthHeaders: AuthHeaders = async (): Promise<
  Record<string, string>
> => {
  const keycloak = window.keycloak;
  if (!keycloak) return {};
  try {
    await keycloak.updateToken(30);
  } catch {
    // The request will fail with 401 and report an expired session.
  }
  return keycloak.token ? { authorization: `Bearer ${keycloak.token}` } : {};
};

const toRequestError = (status: number, text: string) => {
  let data: { message?: string; code?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON (e.g. a proxy error page).
  }
  if (status === 401) {
    return new UploadRequestError(
      'Your session has expired. Please sign in again.',
      status,
      data.code
    );
  }
  return new UploadRequestError(
    data.message || `The upload request failed (HTTP ${status}).`,
    status,
    data.code
  );
};

const networkError = () =>
  new UploadRequestError(
    'Network error. Please check your connection; the upload can be resumed.',
    0
  );

export const createHttpUploadTransport = ({
  baseUrl,
  authHeaders = keycloakAuthHeaders,
}: {
  baseUrl: string;
  authHeaders?: AuthHeaders;
}): UploadTransport => {
  const request = async <T>(
    method: string,
    url: string,
    json?: unknown
  ): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          ...(await authHeaders()),
          ...(json ? { 'content-type': 'application/json' } : {}),
        },
        body: json ? JSON.stringify(json) : undefined,
      });
    } catch {
      throw networkError();
    }
    if (!response.ok) {
      throw toRequestError(response.status, await response.text());
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  };

  const sessionUrl = (uploadId: string) =>
    generatePath(apiRoutes.uploadSession, { uploadId });

  return {
    createSession: (patientId, body) =>
      request<UploadSession>(
        'POST',
        generatePath(apiRoutes.patientUploadSessions, { id: patientId }),
        body
      ),
    getSession: (uploadId) =>
      request<UploadSession>('GET', sessionUrl(uploadId)),
    complete: (uploadId) =>
      request<UploadSession>(
        'POST',
        generatePath(apiRoutes.uploadSessionComplete, { uploadId })
      ),
    cancel: (uploadId) => request<void>('DELETE', sessionUrl(uploadId)),

    // XMLHttpRequest is used because fetch() does not report upload progress.
    putChunk: async ({
      uploadId,
      index,
      totalChunks,
      sha256,
      data,
      onProgress,
      signal,
    }) => {
      const headers = await authHeaders();
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('Upload cancelled', 'AbortError'));
          return;
        }
        const xhr = new XMLHttpRequest();
        xhr.open(
          'PUT',
          `${baseUrl}${generatePath(apiRoutes.uploadSessionChunk, {
            uploadId,
            index: String(index),
          })}`
        );
        Object.entries(headers).forEach(([name, value]) =>
          xhr.setRequestHeader(name, value)
        );
        xhr.setRequestHeader('content-type', 'application/octet-stream');
        xhr.setRequestHeader(UPLOAD_CHUNK_COUNT_HEADER, String(totalChunks));
        xhr.setRequestHeader(UPLOAD_CHUNK_SHA256_HEADER, sha256);
        xhr.upload.onprogress = (event) => onProgress(event.loaded);
        const onAbort = () => xhr.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        const settle = (error?: Error) => {
          signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve();
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? settle()
            : settle(toRequestError(xhr.status, xhr.responseText));
        xhr.onerror = () => settle(networkError());
        xhr.ontimeout = () => settle(networkError());
        xhr.onabort = () =>
          settle(new DOMException('Upload cancelled', 'AbortError'));
        xhr.send(data);
      });
    },
  };
};

/** Hex SHA-256 of a chunk (WebCrypto; requires HTTPS or localhost). */
export const sha256Hex = async (data: Blob): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new UploadRequestError(
      'Uploading requires a secure (HTTPS) connection.',
      -1,
      'INSECURE_CONTEXT',
      false
    );
  }
  const digest = await subtle.digest('SHA-256', await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
};

/** localStorage-backed resume store that never throws. */
export const localResumeStore: ResumeStore = {
  get: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, uploadId) => {
    try {
      window.localStorage.setItem(key, uploadId);
    } catch {
      // Resume after a reload is unavailable; the upload still works.
    }
  },
  remove: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};
