import {
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
  lighten,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  DataGrid,
  GridCellParams,
  GridColDef,
  GridRowId,
  Toolbar,
} from '@mui/x-data-grid';
import { useEffect } from 'react';
import { format } from 'date-fns';
import IconButton from '@mui/material/IconButton';
import Grid3x3Icon from '@mui/icons-material/Grid3x3';
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
import { Link as RouteLink, useNavigate } from 'react-router-dom';
import { TrashedPatientsActionTypes } from '@libs/constants';
import { useAuth } from '../../auth/useAuth';
import { TrashedPatientsAction } from './TrashedPatientsAction';
import { PatientCountChip } from './PatientCountChip';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import {
  getPatientPath,
  isPatientCellNavigable,
  isPatientNavigable,
  shouldOpenPatientOnCellClick,
} from './patientRowNavigation';
import { PatientRowNumber } from './PatientRowNumber';

type Patient = GetPatientsResponse[0];
/***
 * https://mui.com/x/react-data-grid/components/toolbar/#custom-elements
 * https://mui.com/x/react-data-grid/components/export/
 */
export const Patients = WithLoader<GetPatientsResponse>(({ data }) => {
  const { isAdmin } = useAuth();
  const { notifyInfo, notifyError, notifySuccess } = useNotifications();
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const [updatePatient, updatePatientState] = useUpdatePatientMutation();
  const navigate = useNavigate();
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
  // The keyboard/assistive way to open a patient (a row click opens it too).
  const rowNumberColumn: GridColDef<Patient> = {
    field: 'rowNumber',
    headerName: '№',
    width: 60,
    sortable: false,
    filterable: false,
    disableColumnMenu: true,
    disableExport: true,
    renderCell: ({ id, row, tabIndex }: GridCellParams<Patient>) => (
      <PatientRowNumber id={id} patient={row} tabIndex={tabIndex} />
    ),
  };
  const columns: GridColDef<Patient>[] = [
    rowNumberColumn,
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
      renderCell: ({ value }: GridCellParams<Patient, Patient['slug']>) => (
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
      field: 'studyCount',
      headerName: 'Studies',
      flex: 1,
      renderCell: ({ value }: GridCellParams<Patient, Patient['studyCount']>) => (
        <PatientCountChip value={value} />
      ),
    },
    {
      field: 'imageCount',
      headerName: 'Images',
      flex: 1,
      renderCell: ({ value }: GridCellParams<Patient, Patient['imageCount']>) => (
        <PatientCountChip value={value} />
      ),
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
  const mobileColumns: GridColDef<Patient>[] = [
    rowNumberColumn,
    {
      field: 'name',
      headerName: 'Name',
      flex: 1,
      renderCell: ({
        value,
        row,
        tabIndex,
      }: GridCellParams<Patient, Patient['name']>) => (
        <Stack
          direction="row"
          justifyContent="flex-start"
          spacing={1}
          alignItems="center"
          height="100%"
        >
          <Tooltip title={value}>
            {isPatientNavigable(row) ? (
              <Typography
                component={RouteLink}
                to={getPatientPath(row.slug)}
                tabIndex={tabIndex}
                variant="body2"
                noWrap
                sx={{ maxWidth: 200, textDecoration: 'none' }}
              >
                {value}
              </Typography>
            ) : (
              <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                {value}
              </Typography>
            )}
          </Tooltip>
        </Stack>
      ),
    },
    {
      field: 'studyCount',
      headerName: 'Studies',
      flex: 1,
      align: 'center',
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

  // if (matches) {
  //   return (
  //     <Stack spacing={1}>
  //       {data.map(({ slug, name, creatorName, clusters, id }) => (
  //         <Card variant="outlined">
  //           <CardContent>
  //             <Typography
  //               gutterBottom
  //               sx={{ color: 'text.secondary', fontSize: 14 }}
  //             >
  //               {slug}
  //             </Typography>
  //             <Typography
  //               variant="h5"
  //               component={RouteLink}
  //               to={generatePath(guiRoutes.patient, {
  //                 slug,
  //               })}
  //               sx={{ textDecoration: 'none' }}
  //             >
  //               {name}
  //             </Typography>
  //             <Typography sx={{ mt: 2 }} variant="body2">
  //               Creator: {creatorName}
  //             </Typography>
  //             <Typography variant="body2">
  //               Clusters: {clusters.length}
  //             </Typography>
  //           </CardContent>
  //           <CardActions>
  //             <IconButton>
  //               <DeleteForeverIcon />
  //             </IconButton>
  //           </CardActions>
  //         </Card>
  //       ))}
  //     </Stack>
  //   );
  // }

  return (
    <Stack spacing={1}>
      <Stack component={Paper}>
        <DataGrid
          processRowUpdate={handleRowUpdate}
          disableRowSelectionOnClick
          rows={data}
          onCellClick={(params, event) => {
            if (shouldOpenPatientOnCellClick(params, event)) {
              navigate(getPatientPath(params.row.slug));
            }
          }}
          getCellClassName={(params) =>
            isPatientCellNavigable(params) ? 'patient-cell-navigable' : ''
          }
          sx={{
            '.MuiDataGrid-row': {
              '&.trashed': {
                background: (theme) => lighten(theme.palette.error.light, 0.8),
              },
            },
            '.patient-cell-navigable': {
              cursor: 'pointer',
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
          columns={matches ? mobileColumns : columns}
        />
      </Stack>
    </Stack>
  );
});
