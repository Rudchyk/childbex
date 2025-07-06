'use client';

import {
  Stack,
  IconButton,
  Tooltip,
  Chip,
  Avatar,
  useTheme,
} from '@mui/material';
import { useSession, signOut } from 'next-auth/react';
import CircularProgress from '@mui/material/CircularProgress';
import { paths } from '@/lib/constants/paths';
import LogoutIcon from '@mui/icons-material/Logout';
import NextLink from 'next/link';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { UserRoles } from '@/types';
import { useRouter } from 'next/navigation';
import BoltIcon from '@mui/icons-material/Bolt';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import ShieldIcon from '@mui/icons-material/Shield';
import { useEffect } from 'react';

export const AuthUser = () => {
  const session = useSession();
  const router = useRouter();
  const theme = useTheme();
  const { data } = session;
  const checkHealth = async (id: string) => {
    try {
      const resp = await fetch(`/api/health/${id}`);
      console.info('resp.status', resp.status);
      if (resp.status !== 201) {
        signOut({ callbackUrl: paths.login });
      }
    } catch (error) {
      console.error('error', error);
      signOut({ callbackUrl: paths.login });
    }
  };
  useEffect(() => {
    if (data) {
      checkHealth(data.user.id);
    }
  }, [data]);

  if (!data) {
    return <CircularProgress size={15} color="inherit" />;
  }

  const { user } = data || {};
  const { role, name } = user || {};

  const renderIcon = (userRole?: UserRoles) => {
    switch (userRole) {
      case UserRoles.USER:
        return <AccountCircleIcon color="inherit" />;
      case UserRoles.ADMIN:
        return <ShieldIcon sx={{ color: 'white' }} />;
      case UserRoles.SUPER:
        return <BoltIcon sx={{ color: 'white' }} />;
      default:
        return null;
    }
  };
  const getAvatarColor = (userRole?: UserRoles) => {
    switch (userRole) {
      case UserRoles.ADMIN:
        return theme.palette.error.main;
      case UserRoles.SUPER:
        return theme.palette.warning.main;
      case UserRoles.USER:
      default:
        return null;
    }
  };
  const isAdmin = [UserRoles.ADMIN, UserRoles.SUPER].includes(user?.role);

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Tooltip title={user?.email}>
        <Chip
          color="default"
          avatar={
            <Avatar sx={{ bgcolor: getAvatarColor(role) }}>
              {renderIcon(role)}
            </Avatar>
          }
          label={name}
          sx={{ color: (theme) => theme.palette.common.white }}
          variant="outlined"
          onClick={() => router.push(paths.profile)}
        />
      </Tooltip>
      {isAdmin && (
        <Tooltip title="Admin">
          <IconButton
            aria-label="admin"
            LinkComponent={NextLink}
            href={paths.admin}
            color="inherit"
          >
            <AdminPanelSettingsIcon />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Sign Out">
        <IconButton
          aria-label="signOut"
          onClick={() => signOut({ callbackUrl: paths.login })}
          color="inherit"
        >
          <LogoutIcon />
        </IconButton>
      </Tooltip>
    </Stack>
  );
};
