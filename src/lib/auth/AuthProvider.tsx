'use client';

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { SessionHealthProvider } from './SessionHealthProvider';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <SessionProvider>
      <SessionHealthProvider>{children}</SessionHealthProvider>
    </SessionProvider>
  );
};
