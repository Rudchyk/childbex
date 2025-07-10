import { DefaultLayout } from '@/lib/layouts';
import { APIHello } from './APIHello';
import { Stack } from '@mui/material';

export default function Page() {
  return (
    <DefaultLayout>
      <Stack spacing={2}>
        <p>Hello world!</p>
        <APIHello />
      </Stack>
    </DefaultLayout>
  );
}
