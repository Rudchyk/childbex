import { syncDb } from '@/db';
import { PatientModel } from '@/db/models/Patient.model';
import { Stack, Typography } from '@mui/material';
import { Patients } from './_components/Patients';

export default async function Page() {
  await syncDb();
  const patients = await PatientModel.findExtendedPatients();

  return (
    <Stack spacing={1}>
      <Typography variant="h1">Patients</Typography>
      <Patients data={patients} />
    </Stack>
  );
}
