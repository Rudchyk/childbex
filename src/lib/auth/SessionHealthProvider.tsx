'use client';

import React from 'react';
import { useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { paths } from '../constants/paths';

const signOutAction = () => signOut({ callbackUrl: paths.login });
const checkHealth = async (id: string) => {
  try {
    const resp = await fetch(`/api/health/${id}`);
    if (resp.status !== 201) {
      signOutAction();
    }
  } catch (error) {
    console.error('[SessionHealthProvider]', error);
    signOutAction();
  }
};

export const SessionHealthProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const session = useSession();

  useEffect(() => {
    if (session?.data) {
      checkHealth(session.data.user.id);
    }
  }, [session]);

  return children;
};
