import { FC, ReactNode } from 'react';
import { Box, IconButton, Paper, Stack, SxProps, Theme, Tooltip, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

/** Width of a collapsed panel (its restore control). */
export const COLLAPSED_PANEL_WIDTH = 40;

export interface ReviewSidePanelProps {
  /** Id of the panel's content (`aria-controls` of its toggle). */
  id: string;
  /** Visible heading, e.g. "Review". */
  title: string;
  /** Names the panel in the toggle's label, e.g. "review panel". */
  name: string;
  /** Edge of the workspace the panel sits on (from `sm` up). */
  side: 'left' | 'right';
  /** Width when expanded (from `sm` up; full width below). */
  width: number;
  expanded: boolean;
  onToggle: () => void;
  sx?: SxProps<Theme>;
  children: ReactNode;
}

/**
 * A side panel of the Series review workspace that collapses to a compact
 * restore control. Collapsing only hides the content (`hidden`): it stays
 * mounted, so its state (unsaved votes, selection) is kept. The toggle is
 * the same element in both states, so keyboard focus stays on it.
 */
export const ReviewSidePanel: FC<ReviewSidePanelProps> = ({
  id,
  title,
  name,
  side,
  width,
  expanded,
  onToggle,
  sx,
  children,
}) => {
  const label = `${expanded ? 'Hide' : 'Show'} ${name}`;
  // Expanded: points to the edge it collapses to; collapsed: back.
  const towardsEdge = expanded === (side === 'left');
  // Stacked below `sm`: the chevron points up (hide) or down (show).
  const stackedRotation = side === 'left' ? 'rotate(90deg)' : 'rotate(-90deg)';
  return (
    <Paper
      component="section"
      elevation={3}
      aria-label={title}
      data-testid={`${id}-panel`}
      data-expanded={expanded}
      sx={[
        {
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflow: 'hidden',
          width: { xs: '100%', sm: expanded ? width : COLLAPSED_PANEL_WIDTH },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Stack
        direction={{
          xs: 'row-reverse',
          sm: expanded ? (side === 'left' ? 'row-reverse' : 'row') : 'column',
        }}
        alignItems="center"
        spacing={0.5}
        sx={{
          p: 0.5,
          borderBottom: expanded ? 1 : 0,
          borderColor: 'divider',
        }}
      >
        <Tooltip title={label} placement={side === 'left' ? 'right' : 'left'}>
          <IconButton
            size="small"
            onClick={onToggle}
            aria-label={label}
            aria-expanded={expanded}
            aria-controls={id}
          >
            {towardsEdge ? (
              <ChevronLeftIcon sx={{ transform: { xs: stackedRotation, sm: 'none' } }} />
            ) : (
              <ChevronRightIcon sx={{ transform: { xs: stackedRotation, sm: 'none' } }} />
            )}
          </IconButton>
        </Tooltip>
        <Typography
          variant="overline"
          noWrap
          sx={{
            flex: { xs: 1, sm: expanded ? 1 : 'none' },
            lineHeight: 1.5,
            px: 0.5,
            writingMode: { sm: expanded ? 'horizontal-tb' : 'vertical-rl' },
          }}
        >
          {title}
        </Typography>
      </Stack>
      <Box
        id={id}
        hidden={!expanded}
        sx={{
          display: expanded ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {children}
      </Box>
    </Paper>
  );
};
