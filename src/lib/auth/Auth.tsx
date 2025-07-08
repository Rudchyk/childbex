import { syncDb } from '@/db';
import { getServerSession } from 'next-auth';
import React from 'react';
import { authOptions } from './auth.options';
import { UserModel } from '@/db/models/User.model';
import { signOut } from 'next-auth/react';
import { AuthProvider } from './AuthProvider';

export const Auth = async ({ children }: { children: React.ReactNode }) => {
  const session = await getServerSession(authOptions);
  await syncDb();
  const user = await UserModel.findByPk(session?.user?.id);

  if (session && !user) {
    console.error('session user does not exist!');
    signOut();
  }

  return <AuthProvider>{children}</AuthProvider>;
};
