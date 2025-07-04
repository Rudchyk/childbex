'use client';

import { AppBar, Toolbar, Typography, Stack } from '@mui/material';
import { AuthUser } from '@/lib/components';
import NextLink from 'next/link';
import { ThemeSwitcher } from '@/lib/modules/ThemeModule';

export const Header = () => {
  return (
    <AppBar position="static">
      <Toolbar>
        <Typography
          component={NextLink}
          href="/"
          sx={{
            textDecoration: 'none',
            flexGrow: 1,
            color: (theme) => theme.palette.common.white,
          }}
          variant="h6"
        >
          Next App
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <ThemeSwitcher />
          <AuthUser />
        </Stack>
      </Toolbar>
    </AppBar>
  );
};
