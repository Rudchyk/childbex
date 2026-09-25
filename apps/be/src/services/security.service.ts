import createMemoryStore from 'memorystore';
import session from 'express-session';
import type { Express, Request, Response } from 'express';
import Keycloak, { KeycloakConfig } from 'keycloak-connect';
import { logger } from './logger.service';

export type KeycloakType = Keycloak.Keycloak;

const {
  KEYCLOAK_URL = '',
  KEYCLOAK_REALM = '',
  KEYCLOAK_CLIENT = '',
} = process.env;

export const securityIssuer = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
export const keycloakUrl = KEYCLOAK_URL;

/** Adapter settings that tests may override (e.g. a local realm public key). */
export type SecurityConfigOverrides = Partial<KeycloakConfig> & {
  'realm-public-key'?: string;
};

/**
 * Denies API access with JSON instead of keycloak-connect's default
 * (plain-text 403, or a 302 to the login page when not bearer-only):
 * - no valid grant -> 401. `error="invalid_token"` is added only when a
 *   Bearer token was presented but rejected (expired, malformed, bad
 *   signature); a missing token gets a plain `Bearer` challenge.
 * - valid grant without the required role -> 403.
 */
export const apiAccessDenied = (request: Request, response: Response) => {
  const { kauth } = request as Request & { kauth?: { grant?: unknown } };
  if (kauth?.grant) {
    response.status(403).json({
      message: 'Access denied. Insufficient permissions.',
      code: 'FORBIDDEN',
    });
    return;
  }
  const tokenPresented = /^bearer\s+\S/i.test(
    request.headers.authorization ?? ''
  );
  response.setHeader(
    'WWW-Authenticate',
    tokenPresented ? 'Bearer error="invalid_token"' : 'Bearer'
  );
  response.status(401).json({
    message: 'Authentication required.',
    code: 'UNAUTHENTICATED',
  });
};

/**
 * https://www.keycloak.org/securing-apps/nodejs-adapter
 */

export class Security {
  private config: SecurityConfigOverrides & KeycloakConfig = {
    realm: KEYCLOAK_REALM,
    'auth-server-url': KEYCLOAK_URL,
    resource: KEYCLOAK_CLIENT,
    'ssl-required': 'external',
    'confidential-port': 443,
    // The API only accepts Bearer tokens from the SPA (keycloak-js); never
    // redirect API requests to the Keycloak login page.
    'bearer-only': true,
  };
  keycloak: KeycloakType;

  getHeader(token: Keycloak.Token) {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    };
  }

  async verifyToken(token: Keycloak.Token) {
    try {
      const result = await this.keycloak.grantManager.userInfo(token);
      return !!result;
    } catch (error) {
      return false;
    }
  }

  public getConfig(): KeycloakConfig {
    return structuredClone(this.config);
  }

  /** `configOverrides` is for tests (e.g. a local realm public key). */
  constructor(app: Express, configOverrides: SecurityConfigOverrides = {}) {
    this.config = { ...this.config, ...configOverrides };
    const MemoryStore = createMemoryStore(session);
    const store = new MemoryStore({});
    const keycloak = new Keycloak({ store }, this.config);

    logger.debug(this.config, 'Security');

    app.set('trust proxy', true);
    app.use(
      session({
        secret: Math.random().toString(36).slice(2, 7),
        resave: false,
        saveUninitialized: true,
        store,
      })
    );

    keycloak.accessDenied = apiAccessDenied;
    app.use(keycloak.middleware());

    this.keycloak = keycloak;
  }
}

export let security: Security | null = null;

export const setupSecurity = (
  app: Express,
  configOverrides?: SecurityConfigOverrides
): Security => {
  security = new Security(app, configOverrides);
  return security;
};
