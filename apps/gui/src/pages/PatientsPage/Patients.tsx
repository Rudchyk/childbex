'use client';

import {
  Badge,
  Divider,
  InputAdornment,
  Paper,
  Stack,
  styled,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  DataGrid,
  GridCellParams,
  GridColDef,
  GridRowId,
  Toolbar,
  ToolbarButton,
  ExportCsv,
  ExportPrint,
  ColumnsPanelTrigger,
  FilterPanelTrigger,
  QuickFilter,
  QuickFilterTrigger,
  QuickFilterControl,
  QuickFilterClear,
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
import { AddPatient } from './AddPatient/AddPatient';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import PrintIcon from '@mui/icons-material/Print';
import { Link as RouteLink } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import FilterListIcon from '@mui/icons-material/FilterList';
import CancelIcon from '@mui/icons-material/Cancel';
import SearchIcon from '@mui/icons-material/Search';
import TextField from '@mui/material/TextField';

const StyledQuickFilter = styled(QuickFilter)({
  display: 'grid',
  alignItems: 'center',
});

const StyledToolbarButton = styled(ToolbarButton)<{ ownerState: OwnerState }>(
  ({ theme, ownerState }) => ({
    gridArea: '1 / 1',
    width: 'min-content',
    height: 'min-content',
    zIndex: 1,
    opacity: ownerState.expanded ? 0 : 1,
    pointerEvents: ownerState.expanded ? 'none' : 'auto',
    transition: theme.transitions.create(['opacity']),
  })
);

type OwnerState = {
  expanded: boolean;
};

const StyledTextField = styled(TextField)<{
  ownerState: OwnerState;
}>(({ theme, ownerState }) => ({
  gridArea: '1 / 1',
  overflowX: 'clip',
  width: ownerState.expanded ? 260 : 'var(--trigger-width)',
  opacity: ownerState.expanded ? 1 : 0,
  transition: theme.transitions.create(['width', 'opacity']),
}));

type Patient = GetPatientsResponse[0];
/***
 * https://mui.com/x/react-data-grid/components/toolbar/#custom-elements
 * https://mui.com/x/react-data-grid/components/export/
 */
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
          <IconButton
            size="small"
            component={RouteLink}
            target="_blank"
            to={guiRoutes.patient.replace(':slug', value || '')}
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
      getActions: ({ id }) => {
        return [<DeletePatient key={id} id={id as string} />];
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
          slots={{
            toolbar: () => (
              <Toolbar>
                <Tooltip title="Columns">
                  <ColumnsPanelTrigger render={<ToolbarButton />}>
                    <ViewColumnIcon fontSize="small" />
                  </ColumnsPanelTrigger>
                </Tooltip>
                <Tooltip title="Filters">
                  <FilterPanelTrigger
                    render={(props: any, state) => (
                      <ToolbarButton {...props} color="default">
                        <Badge
                          badgeContent={state.filterCount}
                          color="primary"
                          variant="dot"
                        >
                          <FilterListIcon fontSize="small" />
                        </Badge>
                      </ToolbarButton>
                    )}
                  />
                </Tooltip>
                <Divider
                  orientation="vertical"
                  variant="middle"
                  flexItem
                  sx={{ mx: 0.5 }}
                />
                <Tooltip title="Download as CSV">
                  <ExportCsv render={<ToolbarButton />}>
                    <FileDownloadIcon fontSize="small" />
                  </ExportCsv>
                </Tooltip>
                <Tooltip title="Print">
                  <ExportPrint render={<ToolbarButton />}>
                    <PrintIcon fontSize="small" />
                  </ExportPrint>
                </Tooltip>
                <StyledQuickFilter>
                  <QuickFilterTrigger
                    render={(triggerProps: any, state) => (
                      <Tooltip title="Search" enterDelay={0}>
                        <StyledToolbarButton
                          {...triggerProps}
                          ownerState={{ expanded: state.expanded }}
                          color="default"
                          aria-disabled={state.expanded}
                        >
                          <SearchIcon fontSize="small" />
                        </StyledToolbarButton>
                      </Tooltip>
                    )}
                  />
                  <QuickFilterControl
                    render={({ ref, ...controlProps }, state) => (
                      <StyledTextField
                        {...controlProps}
                        ownerState={{ expanded: state.expanded }}
                        inputRef={ref}
                        aria-label="Search"
                        placeholder="Search..."
                        size="small"
                        slotProps={{
                          input: {
                            startAdornment: (
                              <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                              </InputAdornment>
                            ),
                            endAdornment: state.value ? (
                              <InputAdornment position="end">
                                <QuickFilterClear
                                  edge="end"
                                  size="small"
                                  aria-label="Clear search"
                                  material={{ sx: { marginRight: -0.75 } }}
                                >
                                  <CancelIcon fontSize="small" />
                                </QuickFilterClear>
                              </InputAdornment>
                            ) : null,
                            ...controlProps.slotProps?.input,
                          },
                          ...controlProps.slotProps,
                        }}
                      />
                    )}
                  />
                </StyledQuickFilter>
                {/* {session.data?.user?.role &&
                    [UserRoles.ADMIN, UserRoles.SUPER].includes(
                      session.data.user.role
                    ) && (
                      <Tooltip title={t('Trashed patients')}>
                        <ToolbarButton
                          onClick={() =>
                            router.push(paths.adminTrashedPatients)
                          }
                        >
                          <DeleteSweepIcon color="error" fontSize="small" />
                        </ToolbarButton>
                      </Tooltip>
                    )} */}
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
