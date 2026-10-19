import {
  FC,
  memo,
  MouseEvent,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  ButtonBase,
  Checkbox,
  Stack,
  Tooltip,
  Typography,
  type SxProps,
  type Theme,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import GavelIcon from '@mui/icons-material/Gavel';
import { PatientImageReviewVoteTypes, ReviewState, ReviewStateSource } from '@libs/schemas';
import { opinionLabels, type ReviewerOpinion } from './reviewOpinions';
import { aggregateDescription, isResolved } from './aggregateReview';

/** One slice of the list (display order). */
export interface SliceRow {
  /** Stable image id (database id of the DICOM instance). */
  id: string;
  /** Slice index in the viewer. */
  index: number;
  instanceNumber: number | null;
  /** The current reviewer's opinion. */
  opinion: ReviewerOpinion | null;
  /** Aggregate of all reviewers (canonical, from the backend). */
  reviewState: ReviewState;
  /** Why the image has its aggregate state (e.g. an admin resolution). */
  reviewStateSource: ReviewStateSource;
}

export interface SeriesSliceListProps {
  rows: readonly SliceRow[];
  /**
   * The slice on screen, as the viewer reports it (independent of the
   * selection). Never the slice merely asked for: a jump the viewer did
   * not make leaves it unchanged.
   */
  activeId?: string;
  selected: ReadonlySet<string>;
  /**
   * Checkbox: changes the selection (`range` for shift-click). The same
   * click then asks to show that slice (`onNavigate`, once).
   */
  onToggle: (id: string, range: boolean) => void;
  /** Select all: changes the selection only (never navigates). */
  onToggleAll: () => void;
  /** Asks the viewer to show the slice (row and checkbox clicks). */
  onNavigate: (index: number) => void;
  /** Rendered above the list (e.g. bulk actions). */
  header?: ReactNode;
  /** Rendered above Select all (e.g. the review-state filter). */
  toolbar?: ReactNode;
  /** Shown instead of rows when there are none (e.g. an empty filter). */
  emptyMessage?: ReactNode;
}

export const ROW_HEIGHT = 36;
/** Rows rendered beyond the visible ones (smooth scrolling). */
const OVERSCAN = 10;
/** Used before the list was measured (e.g. tests, first render). */
const FALLBACK_HEIGHT = 720;

const opinionStyles: Record<PatientImageReviewVoteTypes, { mark: string; color: string }> = {
  [PatientImageReviewVoteTypes.ABNORMAL]: { mark: 'A', color: 'error.main' },
  [PatientImageReviewVoteTypes.UNCERTAIN]: { mark: '?', color: 'warning.main' },
  [PatientImageReviewVoteTypes.NORMAL]: { mark: 'N', color: 'success.main' },
};

/** "Your opinion: …", or "Your opinion: not marked". */
const opinionTitle = (opinion: ReviewerOpinion | null) =>
  !opinion
    ? 'Your opinion: not marked'
    : opinion.source === 'implicit'
      ? 'Your opinion: Normal (implicit, from your completed review)'
      : `Your opinion: ${opinionLabels[opinion.vote]}`;

const OpinionMark: FC<{ opinion: ReviewerOpinion | null }> = ({ opinion }) => {
  if (!opinion) return <Box sx={{ width: 22 }} />;
  const { mark, color } = opinionStyles[opinion.vote];
  const implicit = opinion.source === 'implicit';
  const title = opinionTitle(opinion);
  return (
    <Tooltip title={title}>
      <Box
        aria-label={title}
        sx={{
          width: 22,
          height: 22,
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          border: '1px solid',
          borderColor: color,
          color: implicit ? color : 'common.white',
          bgcolor: implicit ? 'transparent' : color,
          opacity: implicit ? 0.7 : 1,
        }}
      >
        {mark}
      </Box>
    </Tooltip>
  );
};

/**
 * The aggregate state of all reviewers: a pill with a word (never colour
 * alone), so it is told apart from the own opinion (a square letter) and
 * from the checkbox. Abnormal is filled, Conflicted filled and striped,
 * Not sure outlined bold; Normal and Not reviewed stay quiet but differ in
 * word and border. An admin resolution adds a gavel.
 */
const aggregateStyles: Record<ReviewState, { mark: string; sx: SxProps<Theme> }> = {
  [ReviewState.ABNORMAL]: {
    mark: 'ABN',
    sx: { bgcolor: 'error.main', borderColor: 'error.dark', color: 'error.contrastText' },
  },
  [ReviewState.CONFLICTED]: {
    mark: 'CONF',
    sx: {
      bgcolor: 'warning.main',
      borderColor: 'warning.dark',
      borderWidth: 2,
      color: 'warning.contrastText',
      backgroundImage:
        'repeating-linear-gradient(135deg, rgba(0,0,0,0.18) 0 3px, transparent 3px 7px)',
    },
  },
  [ReviewState.UNCERTAIN]: {
    mark: 'UNSURE',
    sx: { borderColor: 'info.main', borderWidth: 2, color: 'info.main' },
  },
  [ReviewState.NORMAL]: {
    mark: 'NORM',
    sx: { borderColor: 'text.secondary', color: 'text.secondary', fontWeight: 500 },
  },
  [ReviewState.NOT_REVIEWED]: {
    mark: '—',
    sx: { borderColor: 'divider', borderStyle: 'dashed', color: 'text.disabled', fontWeight: 500 },
  },
};

const AggregateMark: FC<{ state: ReviewState; source: ReviewStateSource }> = ({
  state,
  source,
}) => {
  const { mark, sx } = aggregateStyles[state];
  const resolved = isResolved(source);
  const title = aggregateDescription(state, source);
  return (
    <Tooltip title={title}>
      <Stack
        direction="row"
        alignItems="center"
        role="img"
        aria-label={title}
        data-testid="aggregate-mark"
        data-review-state={state}
        data-resolved={resolved}
        sx={{ flexShrink: 0, gap: 0.25 }}
      >
        <Box
          sx={[
            {
              width: 46,
              height: 20,
              borderRadius: 10,
              border: '1px solid',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.2,
              lineHeight: 1,
            },
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
        >
          {mark}
        </Box>
        {resolved && <GavelIcon aria-hidden sx={{ fontSize: 13, color: 'text.secondary' }} />}
      </Stack>
    </Tooltip>
  );
};

interface RowProps {
  row: SliceRow;
  top: number;
  active: boolean;
  selected: boolean;
  onToggle: SeriesSliceListProps['onToggle'];
  onNavigate: SeriesSliceListProps['onNavigate'];
}

/**
 * The slice on screen: a primary (not error/warning) tint over the whole
 * row, a frame with a thick leading bar, bold text and an eye marker, so it
 * reads without colour too. Selection keeps its neutral background and
 * checked box underneath (active + selected shows both); the opinion and
 * conflict marks keep their own colours. No transition (fast scrolling).
 */
const activeRowSx = {
  backgroundImage: (theme: Theme) => {
    const tint = theme.alpha((theme.vars ?? theme).palette.primary.main, 0.2);
    return `linear-gradient(${tint}, ${tint})`;
  },
  boxShadow: (theme: Theme) => {
    const color = (theme.vars ?? theme).palette.primary.main;
    return `inset 6px 0 0 ${color}, inset 0 0 0 2px ${color}`;
  },
};

/** Read by screen readers only. */
const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/** Memoised: a checkbox change re-renders only its own row. */
const Row = memo<RowProps>(({ row, top, active, selected, onToggle, onNavigate }) => {
  const label = `Slice ${row.index + 1}${
    row.instanceNumber === null ? '' : ` · #${row.instanceNumber}`
  }`;
  const onCheckboxClick = (event: MouseEvent) => {
    // One handler for the checkbox (mouse, and Space on the focused box):
    // select, then ask to show this slice once. Not the row's handler.
    event.stopPropagation();
    onToggle(row.id, event.shiftKey);
    onNavigate(row.index);
  };
  const descriptionId = useId();
  return (
    <Stack
      direction="row"
      alignItems="center"
      data-testid="slice-row"
      data-image-id={row.id}
      data-active={active}
      data-review-state={row.reviewState}
      aria-selected={selected}
      sx={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: selected ? 'action.selected' : undefined,
        ...(active ? activeRowSx : {}),
      }}
    >
      <Checkbox
        size="small"
        checked={selected}
        onClick={onCheckboxClick}
        // The click handler owns the state (shift-click ranges).
        onChange={() => undefined}
        slotProps={{ input: { 'aria-label': `Select ${label}` } }}
      />
      <ButtonBase
        onClick={() => onNavigate(row.index)}
        aria-current={active ? 'true' : undefined}
        aria-label={`Show ${label}`}
        // Both states, read after the name (the marks are inside the label).
        aria-describedby={descriptionId}
        sx={{ flex: 1, minWidth: 0, height: '100%', justifyContent: 'space-between', pr: 1 }}
      >
        <Box component="span" id={descriptionId} sx={visuallyHidden}>
          {aggregateDescription(row.reviewState, row.reviewStateSource)}.{' '}
          {opinionTitle(row.opinion)}.
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <AggregateMark state={row.reviewState} source={row.reviewStateSource} />
          <Typography
            variant="body2"
            noWrap
            sx={{ fontWeight: active ? 700 : 400, textAlign: 'left' }}
          >
            {label}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
          {active && (
            <Tooltip title="Shown in the viewer">
              <VisibilityIcon
                data-testid="active-slice-marker"
                // The button already says so (aria-current).
                aria-hidden
                color="primary"
                sx={{ fontSize: 18 }}
              />
            </Tooltip>
          )}
          <OpinionMark opinion={row.opinion} />
        </Stack>
      </ButtonBase>
    </Stack>
  );
});
Row.displayName = 'SliceRow';

/**
 * The slices of a Series with checkboxes (Gmail-like selection) and the
 * active slice: one slice is active (on screen), any number are selected.
 * Only the visible rows are mounted (Series of 1000+ slices).
 */
export const SeriesSliceList: FC<SeriesSliceListProps> = ({
  rows,
  activeId,
  selected,
  onToggle,
  onToggleAll,
  onNavigate,
  header,
  toolbar,
  emptyMessage,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_HEIGHT);
  /** Counts the times the list was shown again after being hidden. */
  const [shownCount, setShownCount] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    let visible = !!element.clientHeight;
    const observer = new ResizeObserver(() => {
      if (!element.clientHeight) {
        // Hidden (e.g. its panel collapsed): the browser drops the scroll
        // position, so it is read again once shown.
        visible = false;
        return;
      }
      setViewportHeight(element.clientHeight);
      setScrollTop(element.scrollTop);
      if (!visible) setShownCount((count) => count + 1);
      visible = true;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the active slice visible (scrolling through the stack, and when
  // the list is shown again).
  const activePosition = useMemo(
    () => rows.findIndex(({ id }) => id === activeId),
    [rows, activeId]
  );
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || activePosition < 0) return;
    const top = activePosition * ROW_HEIGHT;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2);
      setScrollTop(element.scrollTop);
    }
  }, [activePosition, shownCount]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );
  const selectedCount = rows.reduce((count, { id }) => count + (selected.has(id) ? 1 : 0), 0);
  const allSelected = !!rows.length && selectedCount === rows.length;

  return (
    <Stack sx={{ height: '100%' }}>
      {toolbar}
      <Stack
        direction="row"
        alignItems="center"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', pr: 1 }}
      >
        <Checkbox
          size="small"
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          onChange={onToggleAll}
          disabled={!rows.length}
          slotProps={{ input: { 'aria-label': 'Select all slices' } }}
        />
        <Typography variant="body2" data-testid="selection-count">
          {selectedCount ? `${selectedCount} of ${rows.length} selected` : `${rows.length} slices`}
        </Typography>
      </Stack>
      {header}
      <Typography
        variant="caption"
        color="text.secondary"
        data-testid="slice-list-legend"
        sx={{ px: 1, py: 0.25, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        Pill: all reviewers&apos; review state (not a diagnosis) · Square: your opinion
      </Typography>
      {!rows.length && !!emptyMessage && (
        <Typography variant="body2" color="text.secondary" p={1} data-testid="slice-list-empty">
          {emptyMessage}
        </Typography>
      )}
      <Box
        ref={scrollRef}
        role="list"
        aria-label="Series slices"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        sx={{ flex: 1, overflow: 'auto', position: 'relative' }}
      >
        <Box sx={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
          {rows.slice(first, last).map((row, offset) => (
            <Row
              key={row.id}
              row={row}
              top={(first + offset) * ROW_HEIGHT}
              active={row.id === activeId}
              selected={selected.has(row.id)}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
        </Box>
      </Box>
    </Stack>
  );
};
