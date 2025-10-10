import { FC } from 'react';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import { IconButton } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';

export const ThemeSwitcher: FC = () => {
  const { mode, setMode } = useColorScheme();

  if (!mode) {
    return null;
  }

  return (
    <IconButton
      color="inherit"
      onClick={() => {
        setMode(mode === 'dark' ? 'light' : 'dark');
      }}
    >
      {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
    </IconButton>
  );
};
