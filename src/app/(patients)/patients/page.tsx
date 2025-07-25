import { Stack, Typography } from '@mui/material';
import { Patients } from './_components/Patients';
import { findExtendedPatients } from '@/lib/services/patients.service';

export default async function Page() {
  const patients = await findExtendedPatients();
  return (
    <Stack spacing={1}>
      <Typography variant="h1">Patients</Typography>
      <Patients data={patients} />
    </Stack>
  );
}
