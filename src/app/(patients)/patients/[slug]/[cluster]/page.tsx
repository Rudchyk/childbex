'use server';

import { Chip, Stack, Typography } from '@mui/material';
import { notFound } from 'next/navigation';
import { PatientImageCluster } from '@/db/models/PatientImageCluster.model';
import { Patient } from '@/db/models/Patient.model';
import { PatientImage } from '@/db/models/PatientImage.model';
import { format } from 'date-fns';
import pluralize from 'pluralize';
import { PatientBrockenImagesGroup } from './_components/PatientBrockenImagesGroup';
import { PatientImagesGroup } from './_components/PatientImagesGroup';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PermMediaIcon from '@mui/icons-material/PermMedia';

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
      },
    ],
  });

  if (!imagesCluster) {
    return notFound();
  }

  const data = (imagesCluster?.images || []).map((i: any) => i.toJSON());
  const isBrocken = imagesCluster.cluster === -1;
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient.name}</Typography>
      <Stack direction="row" spacing={2} alignItems="center">
        <Chip
          color={isBrocken ? 'error' : 'primary'}
          label={imagesCluster.name}
        />
        {!!imagesCluster.images?.length && (
          <Chip
            color="secondary"
            icon={<PermMediaIcon />}
            label={`${imagesCluster.images.length} ${pluralize(
              'image',
              imagesCluster.images.length
            )}`}
          ></Chip>
        )}
        {!!imagesCluster.studyDate && (
          <Chip
            icon={<CalendarMonthIcon />}
            label={format(imagesCluster.studyDate, 'dd/MM/yyyy HH:mm:sss')}
          />
        )}
      </Stack>
      {isBrocken ? (
        <PatientBrockenImagesGroup data={data} />
      ) : (
        <PatientImagesGroup data={data} />
      )}
    </Stack>
  );
}
