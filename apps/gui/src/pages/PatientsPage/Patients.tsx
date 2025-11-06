import {
  Divider,
  Paper,
  Stack,
  Tooltip,
  Typography,
  lighten,
} from '@mui/material';
import {
  DataGrid,
  GridCellParams,
  GridColDef,
  GridRowId,
  Toolbar,
} from '@mui/x-data-grid';
import { useEffect } from 'react';
// import { AddPatient } from './AddPatient/AddPatient';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { GetPatientsResponse, UpdatePatientRequestBody } from '@libs/schemas';
import { useNotifications } from '../../modules/notifications';
import {
  DataGridColumnsPanelTrigger,
  DataGridFilterPanelTrigger,
  DataGridExportCsv,
  DataGridExportPrint,
  DataGridQuickFilter,
} from '../../components';
import { WithLoader } from '../../hoc';
import { DeletePatient } from './DeletePatient';
import { useUpdatePatientMutation } from '../../store/apis';
import { generatePath, Link as RouteLink } from 'react-router-dom';
import { guiRoutes, TrashedPatientsActionTypes } from '@libs/constants';
import { useAuth } from '../../auth/useAuth';
import { TrashedPatientsAction } from './TrashedPatientsAction';

type Patient = GetPatientsResponse[0];
/***
 * https://mui.com/x/react-data-grid/components/toolbar/#custom-elements
 * https://mui.com/x/react-data-grid/components/export/
 */
export const Patients = WithLoader<GetPatientsResponse>(({ data }) => {
  const { isAdmin } = useAuth();
  const { notifyInfo, notifyError, notifySuccess } = useNotifications();
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
          <IconButton
            size="small"
            component={RouteLink}
            target="_blank"
            // to={guiRoutes.patient.replace(':slug', value || '')}
            to={generatePath(guiRoutes.patient, {
              slug: value,
            })}
          >
            <OpenInNewIcon />
          </IconButton>
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
      getActions: ({ id, row }) => {
        const actions = [];
        if (!row.deletedAt) {
          actions.push(<DeletePatient key={id} id={id as string} />);
        }
        if (isAdmin && row.deletedAt) {
          Object.values(TrashedPatientsActionTypes).forEach((type) => {
            actions.push(
              <TrashedPatientsAction type={type} key={type} id={id as string} />
            );
          });
        }
        return actions;
      },
    },
  ];
  useEffect(() => {
    if (updatePatientState.isError) {
      notifyError(updatePatientState.error);
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
          sx={{
            '.MuiDataGrid-row': {
              '&.trashed': {
                background: (theme) => lighten(theme.palette.error.light, 0.8),
              },
            },
          }}
          isCellEditable={(props) => {
            const { row, colDef } = props;
            if (colDef.editable && row.deletedAt) {
              return false;
            }
            return colDef.editable ?? false;
          }}
          getRowClassName={({ row }) => (row.deletedAt ? 'trashed' : '')}
          slots={{
            toolbar: () => (
              <Toolbar>
                <DataGridColumnsPanelTrigger />
                <DataGridFilterPanelTrigger />
                <Divider
                  orientation="vertical"
                  variant="middle"
                  flexItem
                  sx={{ mx: 0.5 }}
                />
                <DataGridExportCsv />
                <DataGridExportPrint />
                <DataGridQuickFilter />
              </Toolbar>
            ),
          }}
          showToolbar
          columns={columns}
        />
      </Stack>
    </Stack>
  );
});
