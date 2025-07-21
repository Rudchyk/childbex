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
          ChildBEX
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {process.env.NODE_ENV === 'development' && (
            <span>{process.env.NODE_ENV.toUpperCase()}</span>
          )}
          <ThemeSwitcher />
          <AuthUser />
        </Stack>
      </Toolbar>
    </AppBar>
  );
};
