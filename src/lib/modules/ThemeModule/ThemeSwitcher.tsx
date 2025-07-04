'use client';

import { FC } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { IconButton } from '@mui/material';
import { useThemeContext } from './useThemeContext';

export const ThemeSwitcher: FC = () => {
  const { setThemeMode, isDarkMode } = useThemeContext();
  return (
    <IconButton
      color="inherit"
      onClick={() => setThemeMode(isDarkMode ? 'light' : 'dark')}
    >
      {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
    </IconButton>
  );
};
