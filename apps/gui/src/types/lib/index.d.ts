import { SSRSettings } from '@types';
import Keycloak from 'keycloak-js';
import { Socket } from 'socket.io-client';
import {
  PaletteColor,
  PaletteColorOptions,
} from '@mui/material/styles/createPalette';

export {};

declare global {
  interface Window {
    keycloak?: Keycloak;
  }
}

// https://mui.com/material-ui/customization/palette/
declare module '@mui/material/styles' {
  interface Palette {
    tertiary: Palette['primary'];
    component: Palette['component'];
  }
  interface PaletteOptions {
    tertiary?: PaletteOptions['primary'];
    component?: PaletteOptions['component'];
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    tertiary: true;
  }
}
