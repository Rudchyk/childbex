'use client';

import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { FC } from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import MenuIcon from '@mui/icons-material/Menu';
import ContrastIcon from '@mui/icons-material/Contrast';
import SearchIcon from '@mui/icons-material/Search';
import StraightenIcon from '@mui/icons-material/Straighten';
import { ErroredItems } from './ErroredItems';
import { DicomLoadErrorEvents } from './DicomViewer.types';
import { Tags } from './Tags';
import { App } from 'dwv';

interface DicomViewerToolsProps {
  tools: Record<string, unknown>;
  selectedTool: string;
  onChangeTool: (tool: string) => void;
  onReset: () => void;
  canRunTool: (tool: string) => boolean;
  dataLoaded: boolean;
  loadErrorEvents: DicomLoadErrorEvents;
  metaData: any;
  app: App;
}

export const DicomViewerTools: FC<DicomViewerToolsProps> = ({
  selectedTool,
  onChangeTool,
  canRunTool,
  dataLoaded,
  tools,
  onReset,
  metaData,
  loadErrorEvents,
  app,
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
            disabled={!dataLoaded || !canRunTool(tool)}
          >
            {getToolIcon(tool)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButton
        size="small"
        value="reset"
        title="Reset"
        disabled={!dataLoaded}
        onChange={onReset}
      >
        <RefreshIcon />
      </ToggleButton>

      <Tags dataLoaded={dataLoaded} app={app} />
      <ErroredItems data={loadErrorEvents} />
    </Stack>
  );
};
