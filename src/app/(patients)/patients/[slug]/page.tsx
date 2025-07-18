'use server';

import { Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { Patient } from './_components/Patient';
import { findExtendedPatient } from '@/lib/services/patients.service';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const patient = await findExtendedPatient(slug);

  if (!patient) {
    return notFound();
  }

  // const images = (patient.images || []).slice(1, 10);
  const data = (patient.images || []).slice(0, 40);
  // console.log('🚀 ~ Page ~ data:', data);
  // const images = (patient.images || []).slice(1, -1);
  // const images = (patient.images || []).slice(200, 400);
  // const images = patient.images;
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient.name}</Typography>
      <Patient data={data} />
    </Stack>
  );
}
