import { FC, ReactElement, useId, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

export interface Item {
  imageUid: string;
  source: string;
  index: number;
}

/** Width of the expanded image list next to the viewport. */
export const SIDEBAR_WIDTH = 200;
/** Width of the collapsed image list (its restore control). */
export const COLLAPSED_SIDEBAR_WIDTH = 40;

export interface DicomViewerSidebarProps {
  items: Item[];
  currentImageId?: string;
  icon?: (source: string) => ReactElement;
  /** Shows the slice with this index. */
  onJumpTo: (index: number) => void;
  expanded: boolean;
  onToggle: () => void;
}

const focusRing = {
  '&.Mui-focusVisible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: -2,
  },
} as const;

/**
 * The standalone viewer's image list, next to the viewport. Collapsing it
 * only hides the list (`hidden`): it stays mounted, and the toggle is the
 * same element in both states, so keyboard focus stays on it. The viewport
 * takes the width it leaves (dwv refits in place on the resize).
 */
export const DicomViewerSidebar: FC<DicomViewerSidebarProps> = ({
  items = [],
  currentImageId,
  icon = () => <InsertDriveFileIcon />,
  onJumpTo,
  expanded,
  onToggle,
}) => {
  const listId = useId();
  const itemsList = useMemo(() => [...items].reverse(), [items]);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});

  // Keeps the slice on screen visible (also when the list is shown again: a
  // hidden list loses its scroll position). Only the list scrolls, never
  // the page, and only when the row is out of view.
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = currentImageId ? itemRefs.current[currentImageId] : null;
    if (!expanded || !list || !el) return;
    const top = el.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - (list.clientHeight - el.offsetHeight) / 2);
    }
  }, [currentImageId, expanded]);

  const label = `${expanded ? 'Hide' : 'Show'} image list`;
  return (
    <Paper
      component="aside"
      elevation={3}
      aria-label="Image list"
      data-testid="dicom-image-list"
      data-expanded={expanded}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        width: expanded ? SIDEBAR_WIDTH : COLLAPSED_SIDEBAR_WIDTH,
      }}
    >
      <Stack
        direction={expanded ? 'row' : 'column'}
        alignItems="center"
        spacing={0.5}
        sx={{ p: 0.5, borderBottom: expanded ? 1 : 0, borderColor: 'divider' }}
      >
        <Tooltip title={label} placement="left">
          <IconButton
            size="small"
            onClick={onToggle}
            aria-label={label}
            aria-expanded={expanded}
            aria-controls={listId}
            sx={focusRing}
          >
            {expanded ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </Tooltip>
        <Typography
          variant="overline"
          noWrap
          sx={{
            flex: expanded ? 1 : 'none',
            lineHeight: 1.5,
            px: 0.5,
            writingMode: expanded ? undefined : 'vertical-rl',
          }}
        >
          Files ({items.length})
        </Typography>
      </Stack>
      <Box
        hidden={!expanded}
        sx={{
          display: expanded ? 'block' : 'none',
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        <List
          id={listId}
          ref={listRef}
          aria-label="Files"
          dense
          disablePadding
          // Out of the flow: the list never makes the row higher than the
          // toolbar and viewport; it scrolls inside.
          sx={{ position: 'absolute', inset: 0, overflow: 'auto' }}
        >
          {itemsList.map(({ imageUid, source, index }) => {
            const name = source.split('/').pop();
            const current = currentImageId === imageUid;
            return (
              <ListItem
                key={imageUid}
                ref={(el: HTMLLIElement | null) => {
                  itemRefs.current[imageUid] = el;
                }}
                disablePadding
                divider
              >
                <ListItemButton
                  selected={current}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => onJumpTo(index)}
                  alignItems="flex-start"
                  sx={focusRing}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>{icon(source)}</ListItemIcon>
                  <ListItemText primary={name} sx={{ overflowWrap: 'anywhere' }} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>
    </Paper>
  );
};
