import { Box, ToggleButton } from '@mui/material';
import { FC, useMemo } from 'react';
import { useToggle } from '../../../hooks';
import { UIDialog } from '../UIDialog/UIDialog';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import { DicomLoadErrorEvents, DicomLoadErrorEvent } from './DicomViewer.types';
import { DataGrid, GridColDef } from '@mui/x-data-grid';

interface DicomViewerErroredItemsProps {
  data: DicomLoadErrorEvents;
}

export const DicomViewerErroredItems: FC<DicomViewerErroredItemsProps> = ({
  data,
}) => {
  const [open, toggleOpen] = useToggle(false);
  const rows = useMemo(
    () => data.map((item) => ({ ...item, id: item.loadid + item.source })),
    [data]
  );

  if (!rows.length) {
    return null;
  }

  const columns: GridColDef<DicomLoadErrorEvent>[] = [
    {
      field: 'loadid',
      headerName: 'Load ID',
      flex: 1,
    },
    {
      field: 'type',
      headerName: 'type',
      flex: 1,
    },
    {
      field: 'loadtype',
      headerName: 'Load Type',
      flex: 1,
    },
    {
      field: 'source',
      headerName: 'Source',
      width: 300,
    },
    {
      field: 'error',
      headerName: 'Error',
      width: 300,
      valueFormatter: (value: DicomLoadErrorEvent['error']) => value.message,
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
