import { FC } from 'react';
import { Chip, Stack, Typography, type ChipProps } from '@mui/material';
import { sliceFilters, type SliceFilter } from './aggregateReview';

interface SliceReviewFilterProps {
  value: SliceFilter;
  onChange: (value: SliceFilter) => void;
  /** Images of the Series per filter (every presented image, loaded or not). */
  seriesCounts: Record<SliceFilter, number>;
  /** Of those, the slices the viewer has loaded (the ones the list shows). */
  loadedCounts: Record<SliceFilter, number>;
}

/** Colours of the Series review summary chips (with the word, never alone). */
const chipColor: Record<SliceFilter, ChipProps['color']> = {
  all: 'primary',
  abnormal: 'error',
  conflicted: 'warning',
  uncertain: 'info',
};

/**
 * Filters the slice list by the aggregate review state (all reviewers).
 * Counts are of the Series' images; slices the viewer has not loaded yet
 * are counted but not listed, and the difference is said, never hidden.
 */
export const SliceReviewFilter: FC<SliceReviewFilterProps> = ({
  value,
  onChange,
  seriesCounts,
  loadedCounts,
}) => {
  const current = sliceFilters.find((filter) => filter.value === value);
  const notLoaded = seriesCounts[value] - loadedCounts[value];
  return (
    <Stack
      spacing={0.5}
      sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      data-testid="slice-review-filter"
    >
      <Stack
        direction="row"
        flexWrap="wrap"
        useFlexGap
        spacing={0.5}
        role="group"
        aria-label="Filter slices by all reviewers' review state"
      >
        {sliceFilters.map((filter) => {
          const active = filter.value === value;
          return (
            <Chip
              key={filter.value}
              size="small"
              clickable
              color={chipColor[filter.value]}
              variant={active ? 'filled' : 'outlined'}
              aria-pressed={active}
              data-filter={filter.value}
              label={`${filter.label} ${seriesCounts[filter.value]}`}
              onClick={() => onChange(filter.value)}
              sx={{ fontWeight: active ? 700 : 400 }}
            />
          );
        })}
      </Stack>
      {notLoaded > 0 && (
        <Typography variant="caption" color="warning.main" data-testid="slice-filter-not-loaded">
          {loadedCounts[value]} of {seriesCounts[value]}
          {value === 'all' ? '' : ` ${current?.label}`} slices loaded in the viewer; the
          others are listed once loaded.
        </Typography>
      )}
    </Stack>
  );
};
