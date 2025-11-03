import { Tooltip } from '@mui/material';
import { ExportPrint, ToolbarButton } from '@mui/x-data-grid';
import { FC } from 'react';
import PrintIcon from '@mui/icons-material/Print';

interface DataGridExportPrintProps {
  title?: string;
}

export const DataGridExportPrint: FC<DataGridExportPrintProps> = ({
  title = 'Print',
}) => {
  return (
    <Tooltip title={title}>
      <ExportPrint render={<ToolbarButton />}>
        <PrintIcon fontSize="small" />
      </ExportPrint>
    </Tooltip>
  );
};
