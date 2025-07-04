'use client';

import {
  ThemeProvider as MUIThemeProvider,
  PaletteMode,
} from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { FC, useEffect, useMemo, useState } from 'react';
import { createTheme } from '@mui/material/styles';
import { ThemeContext } from './ThemeContext';

export interface ThemeProvider {
  children: React.ReactNode;
}

const localStorageName = 'themeMode';

const defaultThemeMode = 'light';

export const ThemeProvider: FC<ThemeProvider> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<PaletteMode | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(localStorageName) as PaletteMode;
    setThemeMode(stored ?? defaultThemeMode);
  }, []);

  const theme = useMemo(
    () =>
      createTheme({
        cssVariables: true,
        palette: {
          mode: themeMode ?? defaultThemeMode,
        },
        typography: {
          fontFamily: 'var(--font-roboto)',
        },
      }),
    [themeMode]
  );

  useEffect(() => {
    if (themeMode) {
      document.body.setAttribute('data-theme', themeMode);
      localStorage.setItem(localStorageName, themeMode);
    }
  }, [themeMode]);

  if (!themeMode) {
    return null;
  }

  return (
    <AppRouterCacheProvider options={{ key: 'css' }}>
      <ThemeContext.Provider
        value={{ themeMode, setThemeMode, isDarkMode: themeMode === 'dark' }}
      >
        <MUIThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </MUIThemeProvider>
      </ThemeContext.Provider>
    </AppRouterCacheProvider>
  );
};
