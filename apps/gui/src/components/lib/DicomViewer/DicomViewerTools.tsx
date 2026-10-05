import {
  Avatar,
  Chip,
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
import CropSquareIcon from '@mui/icons-material/CropSquare';
import { DicomViewerErroredItems } from './DicomViewerErroredItems';
import { DicomLoadErrorEvents } from './DicomViewer.types';
import { DicomViewerTags } from './DicomViewerTags';
import CheckIcon from '@mui/icons-material/Check';
import { green } from '@mui/material/colors';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import {
  describeCalibration,
  type LengthCalibration,
} from './DicomViewer.calibration';

interface DicomViewerToolsProps {
  tools: readonly string[];
  selectedTool: string;
  onChangeTool: (tool: string) => void;
  /** Fit to the viewport (zoom and pan reset). */
  onReset: () => void;
  /** One image pixel per device pixel ("Actual pixels" 1:1). */
  onActualPixels?: () => void;
  canRunTool: (tool: string) => boolean;
  isDataLoaded: boolean;
  isLoadSuccessful: boolean;
  loadErrorEvents: DicomLoadErrorEvents;
  metaData: Record<string, unknown>;
  /** Calibration of lengths of the displayed image. */
  calibration?: LengthCalibration;
  onClean?: () => void;
}

const toolTitles: Record<string, string> = {
  Scroll: 'Scroll slices',
  WindowLevel: 'Window / level',
  ZoomAndPan: 'Zoom and pan',
  Ruler: 'Ruler (length)',
  Rectangle: 'Area (rectangle)',
};

export const DicomViewerTools: FC<DicomViewerToolsProps> = ({
  selectedTool,
  onChangeTool,
  canRunTool,
  isDataLoaded,
  isLoadSuccessful,
  tools,
  onReset,
  onActualPixels,
  metaData,
  calibration,
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
      case 'Ruler':
        return <StraightenIcon />;
      case 'Rectangle':
        return <CropSquareIcon />;
      case 'WindowLevel':
        return <ContrastIcon />;
      default:
        return null;
    }
  };
  const calibrationInfo = calibration ? describeCalibration(calibration) : null;

  return (
    <Stack
      direction="row"
      spacing={1}
      padding={1}
      justifyContent="center"
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
    >
      <ToggleButtonGroup
        size="small"
        color="primary"
        value={selectedTool}
        exclusive
        onChange={handleToolChange}
      >
        {tools.map((tool) => (
          <ToggleButton
            value={tool}
            key={tool}
            title={toolTitles[tool] ?? tool}
            aria-label={toolTitles[tool] ?? tool}
            disabled={!isDataLoaded || !canRunTool(tool)}
          >
            {getToolIcon(tool)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButton
        size="small"
        value="reset"
        title="Fit to window (reset zoom and pan)"
        aria-label="Fit to window"
        disabled={!isDataLoaded}
        onChange={onReset}
      >
        <RefreshIcon />
      </ToggleButton>
      {!!onActualPixels && (
        <ToggleButton
          size="small"
          value="actual-pixels"
          title="Actual pixels (1:1): one image pixel per screen pixel"
          aria-label="Actual pixels 1:1"
          disabled={!isDataLoaded}
          onChange={onActualPixels}
          sx={{ fontWeight: 700, px: 1.25 }}
        >
          1:1
        </ToggleButton>
      )}
      {isDataLoaded && !!calibrationInfo && (
        <Tooltip title={calibrationInfo.detail}>
          <Chip
            size="small"
            variant="outlined"
            color={calibrationInfo.calibrated ? 'default' : 'warning'}
            icon={<StraightenIcon />}
            label={calibrationInfo.label}
            data-testid="length-calibration"
          />
        </Tooltip>
      )}

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
