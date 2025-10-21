export interface TokenContent {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  auth_time?: number;
  session_state?: string;
  preferred_username?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  realm_access?: {
    roles: string[];
  };
  resource_access?: {
    [client: string]: {
      roles: string[];
    };
  };
  scope?: string;
  client_id?: string;
  username?: string;
  active?: boolean;
}
