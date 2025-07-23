'use server';

import {
  Avatar,
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
import { groupBy } from 'lodash';
import NextLink from 'next/link';
import { paths } from '@/lib/constants/paths';
import ImageIcon from '@mui/icons-material/Image';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const patient = await findExtendedPatient(slug);

  if (!patient) {
    return notFound();
  }

  const imagesMapping = groupBy(patient?.images || [], 'cluster');
  return (
    <Stack spacing={2}>
      <Typography variant="h1">{patient.name}</Typography>
      <nav aria-label="main mailbox folders">
        <List>
          {Object.entries(imagesMapping).map(([key, data]) => (
            <ListItem key={key} disablePadding>
              <ListItemButton
                LinkComponent={NextLink}
                href={`${paths.patients}/${slug}/${key}`}
              >
                <ListItemAvatar>
                  <Avatar>
                    <ImageIcon />
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    key === 'null'
                      ? `Brocken images`
                      : imagesMapping[key][0]?.group || `Group ${key}`
                  }
                  secondary={`${data.length} images`}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </nav>
    </Stack>
  );
}
