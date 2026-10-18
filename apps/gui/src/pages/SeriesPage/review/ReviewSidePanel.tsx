import { FC, ReactNode } from 'react';
import { Box, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

/** Width of a collapsed side panel (its restore control). */
export const COLLAPSED_PANEL_WIDTH = 40;

export interface ReviewSidePanelProps {
  /** Id of the panel's content (`aria-controls` of its toggle). */
  id: string;
  /** Visible heading, e.g. "Review". */
  title: string;
  /** Names the panel in the toggle's label, e.g. "review panel". */
  name: string;
  /** Edge of the workspace the panel sits on (side by side). */
  side: 'left' | 'right';
  /**
   * Stacked under the viewer (full width; collapses to a bar) instead of
   * next to it (`width`; collapses to a narrow rail).
   */
  stacked: boolean;
  /** Width when expanded next to the viewer. */
  width: number;
  /**
   * Height when expanded and stacked (the content scrolls inside it);
   * without it, the content's own height.
   */
  stackedHeight?: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * A side panel of the Series review workspace that collapses to a compact
 * restore control. Collapsing only hides the content (`hidden`): it stays
 * mounted, so its state (unsaved votes, selection) is kept. The toggle is
 * the same element in every state and layout, so keyboard focus stays on it.
 *
 * Both sides share one look: next to the viewer a panel is as high as its
 * row (it never sets the height itself: its content scrolls inside it), and
 * collapsed it is a rail of the same width, toggle on top, vertical title.
 * Only the chevron direction and the toggle's inner edge depend on the side.
 */
export const ReviewSidePanel: FC<ReviewSidePanelProps> = ({
  id,
  title,
  name,
  side,
  stacked,
  width,
  stackedHeight,
  expanded,
  onToggle,
  children,
}) => {
  const label = `${expanded ? 'Hide' : 'Show'} ${name}`;
  // Expanded: points to the edge it collapses to; collapsed: back.
  const towardsEdge = expanded === (side === 'left');
  // Stacked: the chevron points up (hide) or down (show).
  const iconSx = stacked
    ? { transform: side === 'left' ? 'rotate(90deg)' : 'rotate(-90deg)' }
    : undefined;
  const rail = !stacked && !expanded;
  // The content fills a height the panel gets from outside (its row, or
  // `stackedHeight`) instead of setting it.
  const fill = !stacked || !!stackedHeight;
  return (
    <Paper
      component="section"
      elevation={3}
      aria-label={title}
      data-testid={`${id}-panel`}
      data-expanded={expanded}
      data-layout={stacked ? 'stacked' : 'side'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
        width: stacked ? '100%' : expanded ? width : COLLAPSED_PANEL_WIDTH,
        height: stacked && expanded ? stackedHeight : undefined,
      }}
    >
      <Stack
        direction={
          rail ? 'column' : stacked || side === 'left' ? 'row-reverse' : 'row'
        }
        alignItems="center"
        spacing={0.5}
        sx={{ p: 0.5, borderBottom: expanded ? 1 : 0, borderColor: 'divider' }}
      >
        <Tooltip
          title={label}
          placement={stacked ? 'top' : side === 'left' ? 'right' : 'left'}
        >
          <IconButton
            size="small"
            onClick={onToggle}
            aria-label={label}
            aria-expanded={expanded}
            aria-controls={id}
          >
            {towardsEdge ? <ChevronLeftIcon sx={iconSx} /> : <ChevronRightIcon sx={iconSx} />}
          </IconButton>
        </Tooltip>
        <Typography
          variant="overline"
          noWrap
          sx={{
            flex: rail ? 'none' : 1,
            lineHeight: 1.5,
            px: 0.5,
            writingMode: rail ? 'vertical-rl' : undefined,
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
          position: 'relative',
        }}
      >
        <Box
          data-testid={`${id}-content`}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
            // Out of the flow: the content never makes the panel (or its
            // row) higher; it scrolls inside.
            ...(fill ? { position: 'absolute', inset: 0 } : {}),
          }}
        >
          {children}
        </Box>
      </Box>
    </Paper>
  );
};
