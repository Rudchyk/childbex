'use server';

import { List, Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { findExtendedPatient } from '@/lib/services/patients.service';
import { PatientImage } from '@/db/models/PatientImage.model';
import { PatientImagesCluster } from './_components/PatientImagesCluster/PatientImagesCluster';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const result = await findExtendedPatient(slug, {
    patientImageClusterOptions: {
      include: [
        {
          model: PatientImage,
          as: 'images',
          attributes: ['id'],
        },
      ],
    },
  });

  if (!result) {
    return notFound();
  }

  const { clusters = [], name } = result;
  const data = clusters.map((i: any) => i.toJSON());

  return (
    <Stack spacing={2}>
      <Typography variant="h1">{name}</Typography>
      <nav>
        <List>
          {data.map((item) => (
            <PatientImagesCluster key={item.id} slug={slug} item={item} />
          ))}
        </List>
      </nav>
    </Stack>
  );
}
