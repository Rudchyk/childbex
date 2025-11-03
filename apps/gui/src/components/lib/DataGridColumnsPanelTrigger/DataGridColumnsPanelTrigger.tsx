import { Tooltip } from '@mui/material';
import { ColumnsPanelTrigger, ToolbarButton } from '@mui/x-data-grid';
import { FC } from 'react';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';

interface DataGridColumnsPanelTriggerProps {
  title?: string;
}

export const DataGridColumnsPanelTrigger: FC<
  DataGridColumnsPanelTriggerProps
> = ({ title = 'Columns' }) => {
  return (
    <Tooltip title={title}>
      <ColumnsPanelTrigger render={<ToolbarButton />}>
        <ViewColumnIcon fontSize="small" />
      </ColumnsPanelTrigger>
    </Tooltip>
  );
};
