import {
  Avatar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material';
import { FC } from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import MenuIcon from '@mui/icons-material/Menu';
import ContrastIcon from '@mui/icons-material/Contrast';
import SearchIcon from '@mui/icons-material/Search';
import StraightenIcon from '@mui/icons-material/Straighten';
import { DicomViewerErroredItems } from './DicomViewerErroredItems';
import { DicomLoadErrorEvents } from './DicomViewer.types';
import { DicomViewerTags } from './DicomViewerTags';
import CheckIcon from '@mui/icons-material/Check';
import { green } from '@mui/material/colors';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';

interface DicomViewerToolsProps {
  tools: Record<string, unknown>;
  selectedTool: string;
  onChangeTool: (tool: string) => void;
  onReset: () => void;
  canRunTool: (tool: string) => boolean;
  isDataLoaded: boolean;
  isLoadSuccessful: boolean;
  loadErrorEvents: DicomLoadErrorEvents;
  metaData: Record<string, unknown>;
  onClean?: () => void;
}

export const DicomViewerTools: FC<DicomViewerToolsProps> = ({
  selectedTool,
  onChangeTool,
  canRunTool,
  isDataLoaded,
  isLoadSuccessful,
  tools,
  onReset,
  metaData,
  loadErrorEvents,
  onClean,
}) => {
  const handleToolChange = (
    event: React.MouseEvent<HTMLElement>,
    newTool: string
  ) => {
    if (newTool) {
      onChangeTool(newTool);
    }
  };
  const getToolIcon = (tool: string) => {
    switch (tool) {
      case 'Scroll':
        return <MenuIcon />;
      case 'ZoomAndPan':
        return <SearchIcon />;
      case 'Draw':
        return <StraightenIcon />;
      case 'WindowLevel':
        return <ContrastIcon />;
      default:
        return null;
    }
  };

  return (
    <Stack
      direction="row"
      spacing={1}
      padding={1}
      justifyContent="center"
      flexWrap="wrap"
    >
      <ToggleButtonGroup
        size="small"
        color="primary"
        value={selectedTool}
        exclusive
        onChange={handleToolChange}
      >
        {Object.keys(tools).map((tool) => (
          <ToggleButton
            value={tool}
            key={tool}
            title={tool}
            disabled={!isDataLoaded || !canRunTool(tool)}
          >
            {getToolIcon(tool)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButton
        size="small"
        value="reset"
        title="Reset"
        disabled={!isDataLoaded}
        onChange={onReset}
      >
        <RefreshIcon />
      </ToggleButton>

      <DicomViewerTags dataLoaded={isDataLoaded} data={metaData} />
      <DicomViewerErroredItems data={loadErrorEvents} />

      {isLoadSuccessful && (
        <Tooltip title="Dataset loaded successfully">
          <Avatar variant="rounded" sx={{ bgcolor: green[500] }}>
            <CheckIcon />
          </Avatar>
        </Tooltip>
      )}

      {!!onClean && (
        <ToggleButton
          size="small"
          value="clean"
          title="Clean"
          disabled={!isDataLoaded}
          onChange={onClean}
        >
          <HighlightOffIcon />
        </ToggleButton>
      )}
    </Stack>
  );
};
