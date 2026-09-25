/**
 * API authentication with the real keycloak-connect adapter (bearer-only).
 * Tokens are signed with a locally generated RSA key configured as the
 * realm public key, so no Keycloak server or network access is needed.
 */
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { apiRoute } from '@libs/constants';
import { setupSecurity } from './security.service';
import { setupAPIRoutes } from '../api/v1/api';
import { router } from '../api/v1/apiRouter';
import { Patient } from '../db/models/Patient.model';

jest.mock('./logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

const AUTH_SERVER = 'https://auth.example.test';
const REALM = 'test-realm';
const CLIENT = 'dashboard';
const ISSUER = `${AUTH_SERVER}/realms/${REALM}`;

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url');

const signToken = (claims: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      typ: 'Bearer',
      iss: ISSUER,
      sub: 'synthetic-user',
      iat: now - 10,
      exp: now + 300,
      ...claims,
    })
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`;
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const security = setupSecurity(app, {
    'auth-server-url': AUTH_SERVER,
    realm: REALM,
    resource: CLIENT,
    'realm-public-key': publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64'),
  });
  setupAPIRoutes(app, security.keycloak);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const request = (path: string, init: RequestInit = {}) =>
  // `manual` exposes a 302 instead of following it.
  fetch(`${baseUrl}${apiRoute}${path}`, { redirect: 'manual', ...init });

const securedOperations = Object.entries(
  router.openAPIDocument.paths || {}
).flatMap(([path, methods]) =>
  Object.entries(methods || {})
    .filter(
      ([, operation]) =>
        operation &&
        typeof operation === 'object' &&
        !Array.isArray(operation) &&
        'security' in operation &&
        operation.security
    )
    .map(([method]) => ({
      method: method.toUpperCase(),
      path: path.replace(
        /\{([^/{}]+)\}/g,
        '00000000-0000-4000-8000-000000000000'
      ),
    }))
);

const expectUnauthenticated = async (response: Response) => {
  expect(response.status).toBe(401);
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('content-type')).toMatch(/application\/json/);
  expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
};

describe('API authentication (bearer-only)', () => {
  it('covers every secured API route', () => {
    expect(securedOperations.length).toBeGreaterThanOrEqual(20);
  });

  it('returns 401 JSON, never a 302 redirect, when no token is sent', async () => {
    for (const { method, path } of securedOperations) {
      const response = await request(path, { method });
      expect({ method, path, status: response.status }).toMatchObject({
        status: 401,
      });
      await expectUnauthenticated(response);
      // No token presented: generic challenge.
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
    }
  });

  it.each([
    [
      'an expired token',
      () => signToken({ exp: Math.floor(Date.now() / 1000) - 5 }),
    ],
    ['"Bearer undefined"', () => 'undefined'],
    ['a malformed token', () => 'not.a.jwt'],
    [
      'a token from another issuer',
      () => signToken({ iss: 'https://evil.test/realms/x' }),
    ],
    [
      'a token with an invalid signature',
      () => `${signToken().split('.').slice(0, 2).join('.')}.AAAA`,
    ],
  ])('returns 401 with invalid_token for %s', async (_label, token) => {
    const response = await request('/patients', {
      headers: { authorization: `Bearer ${token()}` },
    });
    await expectUnauthenticated(response);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"'
    );
  });

  it('lets a valid token through to the handler', async () => {
    const findAll = jest
      .spyOn(Patient, 'findAll')
      .mockResolvedValue([] as never);
    const response = await request('/patients', {
      headers: { authorization: `Bearer ${signToken()}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(findAll).toHaveBeenCalled();
    findAll.mockRestore();
  });

  it('returns 403 JSON when a valid token lacks the required role', async () => {
    const response = await request('/patients/trash', {
      headers: { authorization: `Bearer ${signToken()}` },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('accepts the role when the token has it', async () => {
    const findAll = jest
      .spyOn(Patient, 'findAll')
      .mockResolvedValue([] as never);
    const response = await request('/patients/trash', {
      headers: {
        authorization: `Bearer ${signToken({
          resource_access: { [CLIENT]: { roles: ['admin'] } },
        })}`,
      },
    });
    expect(response.status).toBe(200);
    findAll.mockRestore();
  });
});
