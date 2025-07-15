'use client';

import PeopleIcon from '@mui/icons-material/People';
import NextLink from 'next/link';
import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { FC } from 'react';
import BiotechIcon from '@mui/icons-material/Biotech';
import { paths } from '@/lib/constants/paths';
import EmojiSymbolsIcon from '@mui/icons-material/EmojiSymbols';

export const Home: FC = () => {
  const links = [
    {
      href: paths.patients,
      label: 'Patients',
      icon: <PeopleIcon />,
    },
    {
      href: paths.dicomViewer,
      label: 'Dicom viewer',
      icon: <BiotechIcon />,
    },
    {
      href: paths.test,
      label: 'Test',
      icon: <EmojiSymbolsIcon />,
    },
  ];
  return (
    <nav aria-label="main mailbox folders">
      <List>
        {links.map(({ href, icon, label }) => (
          <ListItem key={label + href} disablePadding>
            <ListItemButton LinkComponent={NextLink} href={href}>
              <ListItemIcon>{icon}</ListItemIcon>
              <ListItemText primary={label} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </nav>
  );
};
