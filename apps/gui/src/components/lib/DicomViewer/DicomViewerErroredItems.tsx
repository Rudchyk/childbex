import { Box, ToggleButton } from '@mui/material';
import { FC, useMemo } from 'react';
import { useToggle } from '../../../hooks';
import { UIDialog } from '../UIDialog/UIDialog';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import { DicomLoadError } from './DicomViewer.loadErrors';
import { DataGrid, GridColDef } from '@mui/x-data-grid';

interface DicomViewerErroredItemsProps {
  data: DicomLoadError[];
}

export const DicomViewerErroredItems: FC<DicomViewerErroredItemsProps> = ({
  data,
}) => {
  const [open, toggleOpen] = useToggle(false);
  // One row per event (one file can fail more than once). Only the
  // presented error (`presentLoadError`): never dwv's raw message, which
  // can carry patient details.
  const rows = useMemo(
    () => data.map((item, index) => ({ id: index, ...item })),
    [data]
  );

  if (!rows.length) {
    return null;
  }

  const columns: GridColDef<(typeof rows)[number]>[] = [
    {
      field: 'dataid',
      headerName: 'Load ID',
      flex: 1,
    },
    {
      field: 'type',
      headerName: 'type',
      flex: 1,
    },
    {
      field: 'source',
      headerName: 'Input',
      width: 250,
    },
    {
      field: 'label',
      headerName: 'Problem',
      width: 280,
    },
    {
      field: 'detail',
      headerName: 'Details',
      width: 300,
    },
  ];

  return (
    <>
      <ToggleButton
        size="small"
        value="tags"
        title="Errored Items"
        color="error"
        onClick={toggleOpen}
      >
        <ReportGmailerrorredIcon color="error" />
      </ToggleButton>
      <UIDialog
        slotProps={{ dialogProps: { maxWidth: 'lg' } }}
        isButtonCancel={false}
        isButtonPrimary={false}
        open={open}
        onDialogClose={toggleOpen}
        title="Errored Items"
      >
        <Box width={1000}>
          <DataGrid rows={rows} columns={columns} />
        </Box>
      </UIDialog>
    </>
  );
};
