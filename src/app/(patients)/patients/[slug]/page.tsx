'use server';

import { PatientModel } from '@/db/models/Patient.model';
import { Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { DicomViewer } from './_components/DicomViewer';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const patient = await PatientModel.findExtendedPatient(slug);

  if (!patient) {
    return notFound();
  }

  const images = (patient.images || []).slice(1, -1);
  // const images = patient.images;
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient.name}</Typography>
      {/* <DicomViewer images={(patient.images || []).slice(1, 3)} /> */}
      <DicomViewer images={images} />
    </Stack>
  );
}
