'use server';

import { Stack, Typography } from '@mui/material';
import { DicomViewer } from '@/lib/components';

export default async function Page() {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">Dicom Viewer</Typography>
      <DicomViewer />
    </Stack>
  );
}
