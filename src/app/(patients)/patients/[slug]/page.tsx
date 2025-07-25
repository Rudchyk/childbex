'use server';

import {
  Avatar,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { notFound } from 'next/navigation';
import { findExtendedPatient } from '@/lib/services/patients.service';
import NextLink from 'next/link';
import { paths } from '@/lib/constants/paths';
import ImageIcon from '@mui/icons-material/Image';
import { PatientImage } from '@/db/models/PatientImage.model';
import { format } from 'date-fns';
import pluralize from 'pluralize';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';

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

  return (
    <Stack spacing={2}>
      <Typography variant="h1">{name}</Typography>
      <nav aria-label="main mailbox folders">
        <List>
          {clusters.map((item) => {
            const isBrocken = item.cluster === -1;
            return (
              <ListItem key={item.id} disablePadding>
                <ListItemButton
                  LinkComponent={NextLink}
                  href={`${paths.patients}/${slug}/${item.cluster}`}
                >
                  <ListItemAvatar>
                    <Avatar>
                      {isBrocken ? <BrokenImageIcon /> : <ImageIcon />}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      isBrocken
                        ? `Brocken images`
                        : item.name || `Cluster ${item.cluster}`
                    }
                    secondary={
                      item.studyDate
                        ? `Study date: ${format(
                            item.studyDate,
                            'dd/MM/yyyy HH:mm:sss'
                          )}`
                        : ''
                    }
                  />
                  {!!item.images?.length && (
                    <Chip
                      label={`${item.images.length} ${pluralize(
                        'image',
                        item.images.length
                      )}`}
                    />
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </nav>
    </Stack>
  );
}
