'use server';

import { Chip, Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { Patient } from './_components/Patient';
import { findExtendedPatient } from '@/lib/services/patients.service';
import { groupBy } from 'lodash';

interface PageProps {
  params: Promise<{ slug: string; cluster: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug, cluster } = await params;
  const patient = await findExtendedPatient(slug);

  if (!patient) {
    return notFound();
  }

  const imagesMapping = groupBy(patient?.images || [], 'cluster');
  const imagesCluster = imagesMapping[cluster];

  if (!imagesCluster) {
    return notFound();
  }
  const label = cluster === 'null' ? 'Brocken images' : `Cluster ${cluster}`;
  const group = imagesCluster[0]?.group || '';

  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient.name}</Typography>
      <Stack direction="row">
        <Chip label={label} />
      </Stack>
      <Patient data={imagesCluster} label={group} />
    </Stack>
  );
}
