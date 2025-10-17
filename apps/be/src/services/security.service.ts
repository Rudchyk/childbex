import createMemoryStore from 'memorystore';
import session from 'express-session';
import { Express } from 'express';
import Keycloak, { KeycloakConfig } from 'keycloak-connect';
import { logger } from './logger.service';

export type KeycloakType = Keycloak.Keycloak;

const {
  KEYCLOAK_URL = '',
  KEYCLOAK_REALM = '',
  KEYCLOAK_CLIENT = '',
} = process.env;

export class Security {
  private config: KeycloakConfig = {
    realm: KEYCLOAK_REALM,
    'auth-server-url': KEYCLOAK_URL,
    resource: KEYCLOAK_CLIENT,
    'ssl-required': 'external',
    'confidential-port': 443,
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

  constructor(app: Express) {
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

    app.use(keycloak.middleware());

    this.keycloak = keycloak;
  }
}

export let security: Security | null = null;

export const setupSecurity = (app: Express): Security => {
  security = new Security(app);
  return security;
};
