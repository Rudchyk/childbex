import {
  FC,
  memo,
  MouseEvent,
  ReactNode,
  useEffect,
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
} from '@mui/material';
import { PatientImageReviewVoteTypes, ReviewState } from '@libs/schemas';
import { opinionLabels, type ReviewerOpinion } from './reviewOpinions';

/** One slice of the list (display order). */
export interface SliceRow {
  /** Stable image id (database id of the DICOM instance). */
  id: string;
  /** Slice index in the viewer. */
  index: number;
  instanceNumber: number | null;
  /** The current reviewer's opinion. */
  opinion: ReviewerOpinion | null;
  /** Aggregate of all reviewers (e.g. CONFLICTED). */
  reviewState: ReviewState;
}

export interface SeriesSliceListProps {
  rows: readonly SliceRow[];
  /** The slice on screen (independent of the selection). */
  activeId?: string;
  selected: ReadonlySet<string>;
  /** Checkbox: never navigates. `range` for shift-click. */
  onToggle: (id: string, range: boolean) => void;
  onToggleAll: () => void;
  /** Row: shows the slice. */
  onNavigate: (index: number) => void;
  /** Rendered above the list (e.g. bulk actions). */
  header?: ReactNode;
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

const OpinionMark: FC<{ opinion: ReviewerOpinion | null }> = ({ opinion }) => {
  if (!opinion) return <Box sx={{ width: 22 }} />;
  const { mark, color } = opinionStyles[opinion.vote];
  const implicit = opinion.source === 'implicit';
  const title = implicit
    ? 'Your opinion: Normal (implicit, from your completed review)'
    : `Your opinion: ${opinionLabels[opinion.vote]}`;
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

interface RowProps {
  row: SliceRow;
  top: number;
  active: boolean;
  selected: boolean;
  onToggle: SeriesSliceListProps['onToggle'];
  onNavigate: SeriesSliceListProps['onNavigate'];
}

/** Memoised: a checkbox change re-renders only its own row. */
const Row = memo<RowProps>(({ row, top, active, selected, onToggle, onNavigate }) => {
  const label = `Slice ${row.index + 1}${
    row.instanceNumber === null ? '' : ` · #${row.instanceNumber}`
  }`;
  const onCheckboxClick = (event: MouseEvent) => {
    // Selecting never navigates.
    event.stopPropagation();
    onToggle(row.id, event.shiftKey);
  };
  return (
    <Stack
      direction="row"
      alignItems="center"
      data-testid="slice-row"
      data-image-id={row.id}
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
        boxShadow: active ? (theme) => `inset 4px 0 0 ${theme.palette.primary.main}` : undefined,
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
        sx={{ flex: 1, height: '100%', justifyContent: 'space-between', pr: 1 }}
      >
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: active ? 700 : 400, textAlign: 'left' }}
        >
          {label}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {row.reviewState === ReviewState.CONFLICTED && (
            <Tooltip title="Reviewers disagree on this slice">
              <Typography variant="caption" color="error" aria-label="Conflict">
                ≠
              </Typography>
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
 * active slice. Only the visible rows are mounted (Series of 1000+ slices).
 */
export const SeriesSliceList: FC<SeriesSliceListProps> = ({
  rows,
  activeId,
  selected,
  onToggle,
  onToggleAll,
  onNavigate,
  header,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_HEIGHT);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (element.clientHeight) setViewportHeight(element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Keep the active slice visible (scrolling through the stack).
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
  }, [activePosition]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );
  const selectedCount = rows.reduce((count, { id }) => count + (selected.has(id) ? 1 : 0), 0);
  const allSelected = !!rows.length && selectedCount === rows.length;

  return (
    <Stack sx={{ height: '100%' }}>
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
