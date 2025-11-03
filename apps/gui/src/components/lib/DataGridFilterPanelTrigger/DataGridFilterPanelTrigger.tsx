import { Badge, Tooltip } from '@mui/material';
import { FilterPanelTrigger, ToolbarButton } from '@mui/x-data-grid';
import { FC } from 'react';
import FilterListIcon from '@mui/icons-material/FilterList';

interface DataGridFilterPanelTriggerProps {
  title?: string;
}

export const DataGridFilterPanelTrigger: FC<
  DataGridFilterPanelTriggerProps
> = ({ title = 'Filters' }) => {
  return (
    <Tooltip title={title}>
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
  );
};
