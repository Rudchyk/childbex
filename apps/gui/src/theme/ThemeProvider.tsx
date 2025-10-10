import {
  ThemeProvider as MUIThemeProvider,
  PaletteMode,
  useColorScheme,
} from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { FC, useEffect } from 'react';
import { createTheme } from '@mui/material/styles';
import { components } from './lib/components';
import { lightPalette } from './lib/palette';
import { typography } from './lib/typography';
import { useMediaQuery } from '@mui/material';

export interface ThemeProviderProps {
  children: React.ReactNode;
}

const THEME_STORAGE_KEY = 'mui-mode';

export const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
  const { setMode } = useColorScheme();
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = createTheme({
    cssVariables: {
      colorSchemeSelector: 'data',
    },
    colorSchemes: {
      light: {
        palette: lightPalette,
      },
      dark: true,
    },
    typography,
    components,
  });
  const getStoredThemeMode = () => {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const themeMode = localStorage.getItem(THEME_STORAGE_KEY);
    if (!themeMode) {
      return;
    }
    return themeMode as PaletteMode;
  };

  useEffect(() => {
    if (prefersDarkMode && !getStoredThemeMode()) {
      setMode('dark');
    }
  }, [prefersDarkMode]);

  return (
    <MUIThemeProvider theme={theme} defaultMode={getStoredThemeMode()}>
      <CssBaseline />
      {children}
    </MUIThemeProvider>
  );
};
