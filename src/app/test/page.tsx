import { DefaultLayout } from '@/lib/layouts';
import { APIHello } from './APIHello';
import { Stack } from '@mui/material';
import { redirect } from 'next/navigation';

export default function Page() {
  if (process.env.NODE_ENV !== 'development') {
    redirect('/');
  }

  return (
    <DefaultLayout>
      <Stack spacing={2}>
        <p>Hello world!</p>
        <APIHello />
      </Stack>
    </DefaultLayout>
  );
}
