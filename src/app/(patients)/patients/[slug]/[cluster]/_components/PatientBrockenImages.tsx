'use client';

import { FC } from 'react';
import { PatientImage, PatientImageCluster } from '@/types';
import { Alert, AlertTitle, Stack } from '@mui/material';
import { PatientImagesTags } from './PatientImagesTags';

interface PatientBrockenImagesProps {
  data: PatientImage[];
  imagesCluster: PatientImageCluster;
}

export const PatientBrockenImages: FC<PatientBrockenImagesProps> = ({
  data,
  imagesCluster,
}) => {
  return (
    <Stack spacing={2}>
      <PatientImagesTags imagesCluster={imagesCluster} />
      <Stack spacing={2}>
        {data.map(({ id, notes, source }) => (
          <Alert key={id} severity="warning">
            <AlertTitle>{source}</AlertTitle>
            {notes}
          </Alert>
        ))}
      </Stack>
    </Stack>
  );
};
