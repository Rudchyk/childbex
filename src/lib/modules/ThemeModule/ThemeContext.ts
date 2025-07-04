'use client';

import { PaletteMode } from '@mui/material';
import { createContext, Dispatch, SetStateAction } from 'react';

export interface ThemeContextType {
  themeMode: PaletteMode | null;
  isDarkMode: boolean;
  setThemeMode: Dispatch<SetStateAction<PaletteMode | null>>;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined
);
