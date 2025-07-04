'use client';

import { DefaultLayout } from '@/lib/layouts';

export default function Template({ children }: { children: React.ReactNode }) {
  return <DefaultLayout>{children}</DefaultLayout>;
}
