import { DefaultLayout } from '@/lib/layouts';
import { Stack } from '@mui/material';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  return (
    <DefaultLayout>
      <Stack spacing={2}>
        <p>Hello from patient {slug}</p>
      </Stack>
    </DefaultLayout>
  );
}
