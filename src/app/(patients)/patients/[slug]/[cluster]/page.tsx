'use server';

import { Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { PatientImageCluster } from '@/db/models/PatientImageCluster.model';
import { Patient } from '@/db/models/Patient.model';
import { PatientImage } from '@/db/models/PatientImage.model';
import { PatientBrockenImages } from './_components/PatientBrockenImages';
import { PatientImages } from './_components/PatientImages';
import { PatientImageReviewVote } from '@/db/models/PatientImageReviewVote.model';

interface PageProps {
  params: Promise<{ slug: string; cluster: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug, cluster } = await params;
  const patient = await Patient.findOne({ where: { slug } });

  if (!patient) {
    return notFound();
  }

  const imagesCluster = await PatientImageCluster.findOne({
    where: {
      patientId: patient.id,
      cluster,
    },
    include: [
      {
        model: PatientImage,
        as: 'images',
        include: [
          {
            model: PatientImageReviewVote,
            as: 'votes',
          },
        ],
      },
    ],
  });

  if (!imagesCluster) {
    return notFound();
  }

  const data = (imagesCluster?.images || []).map((i: any) => i.toJSON());
  const isBrocken = imagesCluster.cluster === -1;
  const _imagesCluster = imagesCluster.toJSON();
  return (
    <Stack spacing={2}>
      <Typography variant="h1" textAlign="center">
        {patient.name}
      </Typography>
      {isBrocken ? (
        <PatientBrockenImages data={data} imagesCluster={_imagesCluster} />
      ) : (
        <PatientImages data={data} imagesCluster={_imagesCluster} />
      )}
    </Stack>
  );
}
