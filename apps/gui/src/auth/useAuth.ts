import { useContext } from 'react';
import { AuthContext } from './AuthContext';

export enum ROLES {
  ADMIN = 'admin',
  DOCTOR = 'doctor',
  USER = 'user',
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');

  return {
    ...ctx,
    isAdmin: ctx.hasRole(ROLES.ADMIN),
    isDoctor: ctx.hasRole(ROLES.DOCTOR),
    isUser: ctx.hasRole(ROLES.USER),
  };
};
