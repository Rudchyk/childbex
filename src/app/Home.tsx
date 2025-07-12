'use client';

import Masonry from '@mui/lab/Masonry';
import PeopleIcon from '@mui/icons-material/People';
import Paper from '@mui/material/Paper';
import NextLink from 'next/link';
import { Alert, Stack, Theme, Tooltip } from '@mui/material';
import { FC } from 'react';
import BiotechIcon from '@mui/icons-material/Biotech';
import { paths } from '@/lib/constants/paths';

interface HomeProps {
  nodeEnv?: string;
}

export const Home: FC<HomeProps> = ({ nodeEnv }) => {
  const items = [
    {
      label: 'Patients',
      href: paths.patients,
      icon: <PeopleIcon />,
      height: 150,
      colorKey: 'primary' as keyof Theme['palette'],
    },

    {
      label: 'Test',
      href: paths.test,
      icon: <BiotechIcon />,
      height: 80,
      colorKey: 'warning' as keyof Theme['palette'],
    },
  ];
  const getColor = (theme: Theme, key?: keyof Theme['palette']) => {
    if (key) {
      if (
        typeof theme.palette[key] === 'object' &&
        'light' in theme.palette[key]
      ) {
        return theme.palette[key].light as string;
      }
      console.warn(`${key} does not exist in the palette!`);
      return theme.palette.secondary.light;
    }
    return theme.palette.primary.light;
  };
  return (
    <Stack spacing={2}>
      <Alert severity="info">{nodeEnv}</Alert>
      <Masonry columns={4} spacing={2}>
        {items.map(({ height, colorKey, label, href, icon }, index) => (
          <Tooltip key={index} title={label}>
            <Paper
              sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height,
                background: (theme) => getColor(theme, colorKey),
              }}
              component={NextLink}
              href={href}
            >
              {icon}
            </Paper>
          </Tooltip>
        ))}
      </Masonry>
    </Stack>
  );
};
