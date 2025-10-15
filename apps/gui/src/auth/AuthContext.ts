import { createContext } from 'react';

export interface AuthContextType {
  ready: boolean;
  authenticated: boolean;
  token?: string;
  username?: string;
  roles: string[];
  login: (opts?: Keycloak.KeycloakLoginOptions) => void;
  logout: () => void;
  hasRole: (role: string) => boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null);
