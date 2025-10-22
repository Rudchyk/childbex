import { TokenContent as ITokenContent } from './keycloak-connect.types';

declare module 'keycloak-connect' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface
  interface TokenContent extends ITokenContent {}

  interface Token {
    content: TokenContent;
    token: string;
    clientId: string;
    header: unknown;
    signature: string;
    signed: string;
    isExpired(): boolean;
    hasRole(roleName: string): boolean;
    hasApplicationRole(appName: string, roleName: string): boolean;
    hasRealmRole(roleName: string): boolean;
  }

  interface Grant {
    access_token?: Token;
    refresh_token?: Token;
    id_token?: Token;
    expires_in?: number;
    token_type?: string;
    isExpired(): boolean;
    toString(): string;
  }
}

declare global {
  namespace Express {
    interface Request {
      customData: unknown;
      kauth?: {
        grant?: import('keycloak-connect').Grant;
      };
    }
  }
}
