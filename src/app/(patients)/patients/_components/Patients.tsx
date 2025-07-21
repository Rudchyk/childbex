'use client';

import { Paper, Stack, Tooltip, Typography } from '@mui/material';
import {
  DataGrid,
  GridCellParams,
  GridColDef,
  GridRowId,
  Toolbar,
  ToolbarButton,
} from '@mui/x-data-grid';
import { FC, startTransition, useActionState, useEffect } from 'react';
import { AddPatient } from './AddPatient/AddPatient';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
import { UserRoles } from '../../../../db/models/User.model';
import { ExtendedPatient } from '../../../../types';
import { useNotifications } from '../../../../lib/modules/NotificationsModule';
import {
  UpdatePatientData,
  UpdatePatientActionState,
  updatePatient,
} from './UpdatePatient/updatePatient.action';
import { UpdatePatientActionStates } from './UpdatePatient/UpdatePatientActionStates.enum';
import { DeletePatient } from './DeletePatient/DeletePatient';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { paths } from '../../../../lib/constants/paths';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NextLink from 'next/link';

interface PatientProps {
  data: ExtendedPatient[];
}

export const Patients: FC<PatientProps> = ({ data }) => {
  const { notifyInfo, notifyError, notifySuccess, notifyWarning } =
    useNotifications();
  const router = useRouter();
  const session = useSession();
  const [state, formAction] = useActionState<
    UpdatePatientActionState,
    UpdatePatientData
  >(updatePatient, {
    status: UpdatePatientActionStates.IDLE,
  });
  const handleRowUpdate = async (
    updatedRow: ExtendedPatient,
    originalRow: ExtendedPatient,
    params: {
      rowId: GridRowId;
    }
  ): Promise<ExtendedPatient> => {
    const update: UpdatePatientData['data'] = {};
    const fieldsToUpdate: (keyof typeof update)[] = ['name', 'slug', 'notes'];

    fieldsToUpdate.forEach((key) => {
      if (updatedRow[key] !== originalRow[key] && updatedRow[key] !== null) {
        update[key] = updatedRow[key];
      }
    });

    if (Object.keys(update).length) {
      startTransition(() => {
        formAction({ id: params.rowId as string, data: update });
      });
    }

    return updatedRow;
  };
  const copyToClipboard = (text?: string | number) => {
    if (text) {
      navigator.clipboard.writeText(String(text));
      notifyInfo(`${text} was copied`);
    }
  };

  const columns: GridColDef<ExtendedPatient>[] = [
    {
      field: 'id',
      headerName: 'ID',
      width: 50,
      renderCell: ({
        value,
      }: GridCellParams<ExtendedPatient, ExtendedPatient['id']>) => (
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
      editable: true,
    },
    {
      field: 'slug',
      headerName: 'Slug',
      flex: 1,
      editable: true,
      renderCell: ({
        value,
        row,
      }: GridCellParams<ExtendedPatient, ExtendedPatient['slug']>) => (
        <Stack
          direction="row"
          justifyContent="flex-start"
          spacing={1}
          alignItems="center"
          height="100%"
        >
          <Tooltip title={value}>
            <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
              {value}
            </Typography>
          </Tooltip>
          <IconButton
            size="small"
            LinkComponent={NextLink}
            target="_blank"
            href={`${paths.patients}/${row.slug}`}
          >
            <OpenInNewIcon />
          </IconButton>
        </Stack>
      ),
    },

    {
      field: 'creator',
      headerName: 'Creator',
      flex: 1,
      renderCell: ({
        value,
      }: GridCellParams<ExtendedPatient, ExtendedPatient['creator']>) => (
        <Tooltip title={value?.email}>
          <span>{value?.name}</span>
        </Tooltip>
      ),
    },
    {
      field: 'images',
      headerName: 'Images',
      flex: 1,
      valueFormatter: (value: ExtendedPatient['images']) => value?.length || 0,
    },
    {
      field: 'createdAt',
      headerName: 'Created At',
      flex: 1,
      valueFormatter: (value: ExtendedPatient['createdAt']) =>
        value ? format(value, 'dd/MM/yyyy, HH:mm:ss') : '',
    },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 100,
      getActions: ({ id }) => {
        return [<DeletePatient key={id} id={id as string} />];
      },
    },
  ];

  useEffect(() => {
    switch (state.status) {
      case UpdatePatientActionStates.PATIENT_DO_NOT_EXIST:
        notifyWarning('Patient do not exist!');
        break;
      case UpdatePatientActionStates.FAILED:
        notifyError('Failed to updated patient!');
        console.error(state.message);
        break;
      case UpdatePatientActionStates.NOTHING_TO_UPDATE:
        notifyWarning('Nothing to update in patient!');
        break;
      case UpdatePatientActionStates.UNABLE_TO_UPDATE:
        notifyWarning('Unable to update patient!');
        break;
      case UpdatePatientActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case UpdatePatientActionStates.SUCCESS:
        notifySuccess('Patient updated successfully!');
        break;
      default:
        break;
    }
    if (
      ![
        UpdatePatientActionStates.SUCCESS,
        UpdatePatientActionStates.IDLE,
      ].includes(state.status)
    ) {
      router.refresh();
    }
  }, [state]);

  return (
    <Stack component={Paper}>
      <DataGrid
        processRowUpdate={handleRowUpdate}
        disableRowSelectionOnClick
        rows={data}
        slots={{
          toolbar: () => (
            <Toolbar>
              {session.data?.user?.role &&
                [UserRoles.ADMIN, UserRoles.SUPER].includes(
                  session.data.user.role
                ) && (
                  <Tooltip title="Trashed patients">
                    <ToolbarButton
                      onClick={() => router.push(paths.adminTrashedPatients)}
                    >
                      <DeleteSweepIcon color="error" fontSize="small" />
                    </ToolbarButton>
                  </Tooltip>
                )}
              <AddPatient />
            </Toolbar>
          ),
        }}
        showToolbar
        columns={columns}
      />
    </Stack>
  );
};
