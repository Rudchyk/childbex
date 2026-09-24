import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { apiRoute } from '@libs/constants';
import type { KeycloakType } from '../../services/security.service';
import { router } from './apiRouter';
import { setupAPIRoutes, toExpressPath } from './api';

jest.mock('../../services/logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

describe('toExpressPath', () => {
  it.each([
    ['/patients', '/patients'],
    ['/patients/{id}', '/patients/:id'],
    ['/patients/{id}/trash', '/patients/:id/trash'],
    [
      '/patients/slug/{slug}/clusters/cluster/{cluster}',
      '/patients/slug/:slug/clusters/cluster/:cluster',
    ],
    [
      '/patients/images/{id}/review-votes/{voteId}',
      '/patients/images/:id/review-votes/:voteId',
    ],
  ])('%s -> %s', (openApiPath, expressPath) => {
    expect(toExpressPath(openApiPath)).toBe(expressPath);
  });
});

describe('setupAPIRoutes Keycloak protection', () => {
  let server: Server;
  let baseUrl: string;
  const protect = jest.fn(
    (...roles: string[]) =>
      (_req: express.Request, res: express.Response) => {
        // Deny everything: a secured route must never reach its handler.
        res.status(401).json({ deniedBy: 'keycloak.protect', roles });
      }
  );

  // Every secured operation declared through fets/OpenAPI.
  const securedOperations = Object.entries(
    router.openAPIDocument.paths || {}
  ).flatMap(([path, methods]) =>
    Object.entries(methods || {})
      .filter(
        ([, operation]) =>
          operation &&
          !Array.isArray(operation) &&
          typeof operation === 'object' &&
          'security' in operation &&
          operation.security
      )
      .map(([method]) => ({ method: method.toUpperCase(), path }))
  );

  beforeAll(async () => {
    const app = express();
    setupAPIRoutes(app, { protect } as unknown as KeycloakType);
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('covers parameterized routes', () => {
    const parameterized = securedOperations.filter(({ path }) =>
      path.includes('{')
    );
    expect(parameterized.length).toBeGreaterThanOrEqual(8);
    expect(parameterized).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/patients/{id}' },
        { method: 'DELETE', path: '/patients/{id}' },
        { method: 'PATCH', path: '/patients/{id}' },
      ])
    );
  });

  it('rejects requests to every secured route, including :param routes, before the handler runs', async () => {
    expect(securedOperations.length).toBeGreaterThan(0);
    for (const { method, path } of securedOperations) {
      const concrete = path.replace(/\{([^/{}]+)\}/g, 'test-$1');
      const response = await fetch(`${baseUrl}${apiRoute}${concrete}`, {
        method,
      });
      expect({ method, path, status: response.status }).toEqual({
        method,
        path,
        status: 401,
      });
      expect(await response.json()).toMatchObject({
        deniedBy: 'keycloak.protect',
      });
    }
  });

  it('passes required roles to keycloak.protect for parameterized admin routes', async () => {
    const response = await fetch(
      `${baseUrl}${apiRoute}/patients/test-id/trash?type=restore`,
      { method: 'POST' }
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      roles: ['dashboard:admin'],
    });
  });
});
