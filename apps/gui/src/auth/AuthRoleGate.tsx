import React from 'react';
import { useAuth, ROLES } from './useAuth';

export const AuthRoleGate: React.FC<{
  authRole: ROLES;
  children: React.ReactNode;
}> = ({ authRole, children }) => {
  const { hasRole } = useAuth();
  if (!hasRole(authRole))
    return <div style={{ padding: 24 }}>You don’t have access.</div>;
  return <>{children}</>;
};
