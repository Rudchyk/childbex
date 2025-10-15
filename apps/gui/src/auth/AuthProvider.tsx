import React, { useEffect, useMemo, useState } from 'react';
import { initKeycloak } from './keycloak';
import { AuthContext, AuthContextType } from './AuthContext';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | undefined>(undefined);
  const [roles, setRoles] = useState<string[]>([]);
  const [token, setToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const keycloak = await initKeycloak();

      if (cancelled) return;

      // console.log('keycloak', keycloak);

      setAuthenticated(!!keycloak.authenticated);
      setToken(keycloak.token);
      setUsername(keycloak.tokenParsed?.name as string | undefined);

      // Collect realm + client roles
      const realmRoles = (keycloak.tokenParsed?.realm_access?.roles ??
        []) as string[];
      const resourceRoles = Object.values(
        (window.keycloak?.tokenParsed?.resource_access ?? {}) as Record<
          string,
          { roles: string[] }
        >
      ).flatMap((r) => r.roles ?? []);
      setRoles([...new Set([...realmRoles, ...resourceRoles])]);

      // Keep token fresh
      keycloak.onTokenExpired = async () => {
        try {
          const refreshed = await keycloak.updateToken(60);
          if (refreshed) {
            setToken(keycloak.token);
          } else {
            setAuthenticated(false);
          }
        } catch {
          setAuthenticated(false);
        }
      };

      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      ready,
      authenticated,
      token,
      username,
      roles,
      login: (opts) => window.keycloak?.login({ ...opts }),
      logout: () =>
        window.keycloak?.logout({ redirectUri: window.location.origin }),
      hasRole: (role) => roles.includes(role),
    }),
    [ready, authenticated, token, username, roles]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
