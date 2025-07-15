'use server';

import { PatientModel } from '@/db/models/Patient.model';
import { Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { DicomViewer } from '@/lib/components';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const patient = await PatientModel.findExtendedPatient(slug);

  if (!patient) {
    return notFound();
  }

  const images = (patient.images || []).slice(1, 6);
  // const images = (patient.images || []).slice(1, -1);
  // const images = (patient.images || []).slice(200, 400);
  // const images = patient.images;
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient.name}</Typography>
      <DicomViewer images={images} />
    </Stack>
  );
}
