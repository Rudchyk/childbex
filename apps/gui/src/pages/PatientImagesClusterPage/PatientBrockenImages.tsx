import { FC } from 'react';
import { GetPatientClusterResponse } from '@libs/schemas';
import { Alert, AlertTitle, Stack } from '@mui/material';
import { PatientImagesTags } from './PatientImagesTags';

interface PatientBrockenImagesProps {
  data: GetPatientClusterResponse;
}

export const PatientBrockenImages: FC<PatientBrockenImagesProps> = ({
  data,
}) => {
  return (
    <Stack spacing={2}>
      <PatientImagesTags imagesCluster={data} />
      <Stack spacing={2}>
        {(data.images || []).map(({ id, notes, source }) => (
          <Alert key={id} severity="warning">
            <AlertTitle>{source}</AlertTitle>
            {notes}
          </Alert>
        ))}
      </Stack>
    </Stack>
  );
};
