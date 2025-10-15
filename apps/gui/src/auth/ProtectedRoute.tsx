import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { ready, authenticated, login } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (ready && !authenticated) {
      // Trigger Keycloak login only when the user hits a protected route
      login({
        redirectUri:
          window.location.origin + location.pathname + location.search,
      });
    }
  }, [ready, authenticated, login, location]);

  if (!ready) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!authenticated)
    return <div style={{ padding: 24 }}>Redirecting to login…</div>;
  return <>{children}</>;
};
