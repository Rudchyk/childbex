import { FC } from 'react';
import { Chip, Stack } from '@mui/material';
import pluralize from 'pluralize';
import type { ReviewSummary } from '@libs/schemas';

interface ReviewSummaryChipsProps {
  summary: ReviewSummary;
}

/** Review progress of a Study / Series (broken images counted apart). */
export const ReviewSummaryChips: FC<ReviewSummaryChipsProps> = ({ summary }) => {
  const reviewable = summary.total - summary.broken;
  const reviewed = reviewable - summary.notReviewed;
  const states = [
    { label: 'normal', value: summary.normal, color: 'primary' },
    { label: 'abnormal', value: summary.abnormal, color: 'error' },
    { label: 'uncertain', value: summary.uncertain, color: 'info' },
    { label: 'conflicted', value: summary.conflicted, color: 'warning' },
  ] as const;
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      <Chip
        size="small"
        label={`${summary.total} ${pluralize('image', summary.total)}`}
      />
      <Chip size="small" variant="outlined" label={`reviewed ${reviewed}/${reviewable}`} />
      {states
        .filter(({ value }) => value > 0)
        .map(({ label, value, color }) => (
          <Chip key={label} size="small" color={color} label={`${label} ${value}`} />
        ))}
      {summary.broken > 0 && (
        <Chip size="small" color="default" label={`broken ${summary.broken}`} />
      )}
    </Stack>
  );
};
