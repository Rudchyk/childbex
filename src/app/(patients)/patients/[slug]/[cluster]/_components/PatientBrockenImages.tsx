'use client';

import { FC } from 'react';
import { PatientImage } from '@/types';
import { Alert, AlertTitle, Stack } from '@mui/material';

interface PatientBrockenImagesProps {
  data: PatientImage[];
}

export const PatientBrockenImages: FC<PatientBrockenImagesProps> = ({
  data,
}) => {
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
