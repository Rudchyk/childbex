'use client';

import { Paper, Stack, Tooltip } from '@mui/material';
import { DataGrid, GridCellParams, GridColDef } from '@mui/x-data-grid';
import { FC } from 'react';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
import { Patient } from '@/types';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { TrashAction } from './TrashedPatientsAction';
import { TrashedPatientsActionTypes } from './TrashedPatientsActionTypes.enum';

interface TrashedPatientsProps {
  data: Patient[];
}

export const TrashedPatients: FC<TrashedPatientsProps> = ({ data }) => {
  const { notifyInfo } = useNotifications();
  const copyToClipboard = (text?: string | number) => {
    if (text) {
      navigator.clipboard.writeText(String(text));
      notifyInfo(`${text} was copied`);
    }
  };

  const columns: GridColDef<Patient>[] = [
    {
      field: 'id',
      headerName: 'ID',
      width: 50,
      renderCell: ({ value }: GridCellParams<Patient, Patient['id']>) => (
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
      field: 'name',
      headerName: 'Name',
      flex: 1,
    },
    {
      field: 'creator',
      headerName: 'Creator',
      flex: 1,
      renderCell: ({ value }: GridCellParams<Patient, Patient['creator']>) => (
        <Tooltip title={value?.email}>
          <span>{value?.name}</span>
        </Tooltip>
      ),
    },
    {
      field: 'clusters',
      headerName: 'Clusters',
      flex: 1,
      valueFormatter: (value: Patient['clusters']) => value?.length || 0,
    },
    {
      field: 'createdAt',
      headerName: 'Created At',
      flex: 1,
      valueFormatter: (value: Patient['createdAt']) =>
        value ? format(value, 'dd/MM/yyyy, HH:mm:ss') : '',
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      getActions: ({ id }) => {
        return Object.values(TrashedPatientsActionTypes).map((type) => (
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
