'use client';

import { Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { DataGrid, GridCellParams, GridColDef } from '@mui/x-data-grid';
import { FC } from 'react';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
import { PublicUser, UserRoles } from '../../../../../../types';
import { useNotifications } from '../../../../../../lib/modules/NotificationsModule/useNotifications';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { TrashAction } from './TrashAction';
import { TrashedUsersActionTypes } from './TrashedUsersActionTypes.enum';

interface TrashedUsersProps {
  data: PublicUser[];
}

export const TrashedUsers: FC<TrashedUsersProps> = ({ data }) => {
  const { notifyInfo } = useNotifications();
  const copyToClipboard = (text?: string | number) => {
    if (text) {
      navigator.clipboard.writeText(String(text));
      notifyInfo(`${text} was copied`);
    }
  };
  const getRoleChipColor = (role?: UserRoles) => {
    switch (role) {
      case UserRoles.ADMIN:
        return 'error';
      case UserRoles.SUPER:
        return 'primary';
      case UserRoles.USER:
      default:
        return 'default';
    }
  };

  const columns: GridColDef<PublicUser>[] = [
    {
      field: 'id',
      headerName: 'ID',
      width: 50,
      renderCell: ({ value }: GridCellParams<PublicUser, PublicUser['id']>) => (
        <Stack justifyContent="center" alignItems="center" height="100%">
          <Tooltip title={value}>
            <IconButton onClick={() => copyToClipboard(value)}>
              <Grid3x3Icon />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
    {
      field: 'email',
      headerName: 'Email',
      width: 250,
      renderCell: ({
        value,
      }: GridCellParams<PublicUser, PublicUser['email']>) => (
        <Stack
          direction="row"
          justifyContent="space-between"
          spacing={1}
          alignItems="center"
          height="100%"
        >
          <Tooltip title={value}>
            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
              {value}
            </Typography>
          </Tooltip>
          <IconButton size="small" onClick={() => copyToClipboard(value)}>
            <ContentCopyIcon />
          </IconButton>
        </Stack>
      ),
    },
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
    },
    {
      field: 'role',
      headerName: 'Role',
      width: 130,
      renderCell: ({
        value,
      }: GridCellParams<PublicUser, PublicUser['role']>) => (
        <Chip label={value?.toUpperCase()} color={getRoleChipColor(value)} />
      ),
    },
    {
      field: 'createdAt',
      headerName: 'Created At',
      flex: 1,
      valueFormatter: (value: PublicUser['createdAt']) =>
        value ? format(value, 'dd/MM/yyyy, HH:mm:ss') : '',
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      getActions: ({ id }) => {
        return Object.values(TrashedUsersActionTypes).map((type) => (
          <TrashAction type={type} key={type} id={id as string} />
        ));
      },
    },
  ];

  return (
    <Stack component={Paper}>
      <DataGrid disableRowSelectionOnClick rows={data} columns={columns} />
    </Stack>
  );
};
