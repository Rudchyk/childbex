import { FC, useMemo } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { format } from 'date-fns';
import pluralize from 'pluralize';
import { defaultDateFormat } from '@libs/constants';
import type { PatientSeriesResponse } from '@libs/schemas';
import {
  progressSummary,
  reviewerProgress,
  reviewerStatusLabels,
  UNNAMED_REVIEWER,
  type ReviewerProgress,
  type ReviewerStatus,
} from './reviewerProgress';

const statusColors: Record<ReviewerStatus, 'success' | 'warning' | 'default'> =
  {
    completed: 'success',
    needsRecompletion: 'warning',
    notCompleted: 'default',
  };

const statusDetail = (reviewer: ReviewerProgress) => {
  if (reviewer.status === 'notCompleted') {
    return `${reviewer.explicitVoteCount} ${pluralize(
      'image',
      reviewer.explicitVoteCount
    )} marked, review not completed`;
  }
  const date = reviewer.completedAt
    ? `Completed ${format(reviewer.completedAt, defaultDateFormat)}`
    : 'Completed';
  if (reviewer.status === 'completed')
    return `${date} · covers the current images`;
  const uncovered = reviewer.uncoveredImageCount ?? 0;
  return uncovered
    ? `${date} · ${uncovered} new ${pluralize('image', uncovered)} not covered`
    : `${date} · the image set changed since`;
};

interface ReviewProgressProps {
  data: Pick<PatientSeriesResponse, 'images' | 'review'>;
  currentUserId?: string;
  /** The signed-in user can vote and complete reviews. */
  canReview: boolean;
}

/**
 * Every known reviewer's own review progress of the Series (completion
 * records and explicit votes; there is no assigned-reviewer list). Workflow
 * visibility only: it decides no consensus, and one reviewer's completion
 * neither completes nor locks the Series for anyone else.
 */
export const ReviewProgress: FC<ReviewProgressProps> = ({
  data,
  currentUserId,
  canReview,
}) => {
  const progress = useMemo(
    () => reviewerProgress(data, currentUserId),
    [data, currentUserId]
  );
  const { reviewers } = progress;
  const titleId = 'series-review-progress-title';
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      data-testid="review-progress"
      sx={{ px: 1, py: 1 }}
    >
      <Typography id={titleId} component="h2" variant="subtitle2">
        Review progress
      </Typography>
      {reviewers.length ? (
        <>
          <Typography variant="body2" data-testid="review-progress-summary">
            {progressSummary(progress)}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="p"
            data-testid="review-progress-known"
          >
            {reviewers.length} known {pluralize('reviewer', reviewers.length)}{' '}
            (voted or completed). Not a list of assigned reviewers.
          </Typography>
          <Stack
            component="ul"
            spacing={0.5}
            aria-label="Reviewers of this series"
            sx={{ listStyle: 'none', m: 0, mt: 1, p: 0 }}
          >
            {reviewers.map((reviewer) => {
              const name = reviewer.name ?? UNNAMED_REVIEWER;
              const status = reviewerStatusLabels[reviewer.status];
              const detail = statusDetail(reviewer);
              return (
                <Box
                  component="li"
                  key={reviewer.reviewerId}
                  data-testid="reviewer-progress"
                  data-reviewer-id={reviewer.reviewerId}
                  data-status={reviewer.status}
                  sx={{
                    p: 0.75,
                    borderRadius: 1,
                    border: 1,
                    borderColor: reviewer.isYou ? 'primary.main' : 'divider',
                    minWidth: 0,
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={0.5}
                    alignItems="center"
                    sx={{ minWidth: 0 }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
                    >
                      {reviewer.isYou && (
                        <Box component="span" sx={{ fontWeight: 'bold' }}>
                          Your review{' · '}
                        </Box>
                      )}
                      <Box
                        component="span"
                        sx={
                          reviewer.name
                            ? undefined
                            : { fontStyle: 'italic', color: 'text.secondary' }
                        }
                      >
                        {name}
                      </Box>
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={statusColors[reviewer.status]}
                      label={status}
                      sx={{ flexShrink: 0 }}
                    />
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                  >
                    {detail}
                  </Typography>
                </Box>
              );
            })}
          </Stack>
          {canReview && progress.youHaveNoActivity && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ mt: 1 }}
            >
              You have not marked or completed this series yet.
            </Typography>
          )}
        </>
      ) : (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="review-progress-empty"
        >
          No reviewer activity yet.
        </Typography>
      )}
    </Box>
  );
};
