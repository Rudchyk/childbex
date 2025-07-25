'use client';

import { FC } from 'react';
import { Box, Paper } from '@mui/material';
import { PatientImage } from '@/types';

export interface PatientImagesSidebarProps {
  item?: PatientImage;
}

export const PatientImagesSidebar: FC<PatientImagesSidebarProps> = ({
  item,
}) => {
  if (!item) {
    return null;
  }
  return (
    <Box
      component={Paper}
      elevation={3}
      sx={{
        position: 'fixed',
        top: '10%',
        bottom: '10%',
        left: 5,
        width: 300,
      }}
    >
      {item.id}
    </Box>
  );
};
