'use client';

import { FC } from 'react';
import { PatientImage } from '@/types';
import { Alert, AlertTitle, Stack } from '@mui/material';

interface PatientBrockenImagesClusterProps {
  data: PatientImage[];
}

export const PatientBrockenImagesCluster: FC<
  PatientBrockenImagesClusterProps
> = ({ data }) => {
  return (
    <Stack spacing={2}>
      {data.map(({ id, notes, source }) => (
        <Alert key={id} severity="warning">
          <AlertTitle>{source}</AlertTitle>
          {notes}
        </Alert>
      ))}
    </Stack>
  );
};
