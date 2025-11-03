import { Tooltip } from '@mui/material';
import { ExportCsv, ToolbarButton } from '@mui/x-data-grid';
import { FC } from 'react';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

interface DataGridExportCsvProps {
  title?: string;
}

export const DataGridExportCsv: FC<DataGridExportCsvProps> = ({
  title = 'Download as CSV',
}) => {
  return (
    <Tooltip title={title}>
      <ExportCsv render={<ToolbarButton />}>
        <FileDownloadIcon fontSize="small" />
      </ExportCsv>
    </Tooltip>
  );
};
