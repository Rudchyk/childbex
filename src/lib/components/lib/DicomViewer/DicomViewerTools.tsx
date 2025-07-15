import {
  List,
  ListItem,
  ListItemText,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { FC } from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import MenuIcon from '@mui/icons-material/Menu';
import ContrastIcon from '@mui/icons-material/Contrast';
import SearchIcon from '@mui/icons-material/Search';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import StraightenIcon from '@mui/icons-material/Straighten';
import { useToggle } from 'usehooks-ts';
import { UIDialog } from '@/lib/components';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import CrisisAlertIcon from '@mui/icons-material/CrisisAlert';

interface DicomViewerToolsProps {
  tools: Record<string, unknown>;
  selectedTool: string;
  onChangeTool: (tool: string) => void;
  onReset: () => void;
  canRunTool: (tool: string) => boolean;
  dataLoaded: boolean;
  erroredItems?: string[];
  abortedItems?: string[];
  metaData: unknown;
}

export const DicomViewerTools: FC<DicomViewerToolsProps> = ({
  selectedTool,
  onChangeTool,
  canRunTool,
  dataLoaded,
  tools,
  onReset,
  metaData,
  abortedItems,
  erroredItems,
}) => {
  const [open, toggleOpen] = useToggle(false);
  const [abortedItemsOpen, toggleAbortedItemsOpen] = useToggle(false);
  const [erroredItemsOpen, toggleErroredItemsOpen] = useToggle(false);
  const handleToolChange = (
    event: React.MouseEvent<HTMLElement>,
    newTool: any
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

      <ToggleButton
        size="small"
        value="tags"
        title="Tags"
        disabled={!dataLoaded}
        onClick={toggleOpen}
      >
        <LibraryBooksIcon />
      </ToggleButton>
      <UIDialog open={open} onDialogClose={toggleOpen} title="DICOM Tags">
        <pre>{JSON.stringify(metaData, null, 2)}</pre>
      </UIDialog>

      {!!abortedItems?.length && (
        <>
          <ToggleButton
            size="small"
            value="tags"
            title="Aborted Items"
            color="warning"
            disabled={!dataLoaded}
            onClick={toggleAbortedItemsOpen}
          >
            <CrisisAlertIcon color="warning" />
          </ToggleButton>
          <UIDialog
            open={abortedItemsOpen}
            onDialogClose={toggleAbortedItemsOpen}
            title="Aborted Items"
          >
            <List>
              {abortedItems.map((item) => (
                <ListItem key={item} disablePadding>
                  <ListItemText primary={item} />
                </ListItem>
              ))}
            </List>
          </UIDialog>
        </>
      )}

      {!!erroredItems?.length && (
        <>
          <ToggleButton
            size="small"
            value="tags"
            title="Errored Items"
            color="error"
            disabled={!dataLoaded}
            onClick={toggleErroredItemsOpen}
          >
            <ReportGmailerrorredIcon color="error" />
          </ToggleButton>
          <UIDialog
            open={erroredItemsOpen}
            onDialogClose={toggleErroredItemsOpen}
            title="Errored Items"
          >
            <List>
              {erroredItems.map((item) => (
                <ListItem key={item} disablePadding>
                  <ListItemText primary={item} />
                </ListItem>
              ))}
            </List>
          </UIDialog>
        </>
      )}
    </Stack>
  );
};
