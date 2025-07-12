import { PatientModel } from '@/db/models/Patient.model';
import { Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const patient = await PatientModel.findExtendedPatient(slug);

  if (!patient) {
    return notFound();
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient?.name}</Typography>
      <p>Hello from patient {slug}</p>
    </Stack>
  );
}
