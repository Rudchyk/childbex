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
// import { AddPatient } from './AddPatient/AddPatient';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { GetPatientsResponse, UpdatePatientRequestBody } from '@libs/schemas';
import { useNotifications } from '../../modules/notifications';
import { WithLoader } from '../../hoc';
import { DeletePatient } from './DeletePatient';
import { useUpdatePatientMutation } from '../../store/apis';
import { getErrorMessage } from '../../utils';

type Patient = GetPatientsResponse[0];

export const Patients = WithLoader<GetPatientsResponse>(({ data }) => {
  const { notifyInfo, notifyError, notifySuccess, notifyWarning } =
    useNotifications();
  const [updatePatient, updatePatientState] = useUpdatePatientMutation();
  const handleRowUpdate = async (
    updatedRow: Patient,
    originalRow: Patient,
    params: {
      rowId: GridRowId;
    }
  ): Promise<Patient> => {
    const update: UpdatePatientRequestBody = {};
    const fieldsToUpdate: (keyof typeof update)[] = ['name', 'slug', 'notes'];

    fieldsToUpdate.forEach((key) => {
      if (updatedRow[key] !== originalRow[key] && updatedRow[key] !== null) {
        update[key] = updatedRow[key];
      }
    });

    if (Object.keys(update).length) {
      updatePatient({
        id: params.rowId as string,
        ...update,
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
      }: GridCellParams<Patient, Patient['slug']>) => (
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
          {/* <IconButton
            size="small"
            LinkComponent={NextLink}
            target="_blank"
            href={`${paths.patients}/${row.slug}`}
          >
            <OpenInNewIcon />
          </IconButton> */}
        </Stack>
      ),
    },
    {
      field: 'creatorName',
      headerName: 'Creator',
      flex: 1,
      renderCell: ({
        value,
        row,
      }: GridCellParams<Patient, Patient['creatorName']>) => (
        <Tooltip title={row?.creatorId}>
          <span>{value}</span>
        </Tooltip>
      ),
    },
    {
      field: 'notes',
      headerName: 'Notes',
      flex: 1,
      editable: true,
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
        return [<DeletePatient key={id} id={id as string} />];
      },
    },
  ];
  useEffect(() => {
    if (updatePatientState.isError) {
      notifyError(getErrorMessage(updatePatientState.error));
    }
  }, [updatePatientState.isError]);

  useEffect(() => {
    if (updatePatientState.isSuccess) {
      notifySuccess(
        `User ${updatePatientState.data.name} was updated successfully!`
      );
    }
  }, [updatePatientState.isSuccess]);

  return (
    <Stack spacing={1}>
      <Stack component={Paper}>
        <DataGrid
          processRowUpdate={handleRowUpdate}
          disableRowSelectionOnClick
          rows={data}
          slots={
            {
              // toolbar: () => (
              //   <Toolbar>
              //     {session.data?.user?.role &&
              //       [UserRoles.ADMIN, UserRoles.SUPER].includes(
              //         session.data.user.role
              //       ) && (
              //         <Tooltip title={t('Trashed patients')}>
              //           <ToolbarButton
              //             onClick={() =>
              //               router.push(paths.adminTrashedPatients)
              //             }
              //           >
              //             <DeleteSweepIcon color="error" fontSize="small" />
              //           </ToolbarButton>
              //         </Tooltip>
              //       )}
              //     <AddPatient />
              //   </Toolbar>
              // ),
            }
          }
          showToolbar
          columns={columns}
        />
      </Stack>
    </Stack>
  );
});
