import { FC } from 'react';
import { Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { format } from 'date-fns';
import { defaultDateFormat } from '@libs/constants';
import type { SeriesReviewCompletion } from '@libs/schemas';
import { DialogAreYouSure } from '../../components';
import { useToggle } from '../../hooks';
import { useNotifications } from '../../modules/notifications';
import { useCompleteSeriesReviewMutation } from '../../store/apis';

interface CompleteSeriesReviewProps {
  patientId: string;
  seriesId: string;
  /** Exactly the images handed to (and loaded by) the viewer. */
  presentedImageIds: string[];
  /** Why the series cannot be completed now (disables the button). */
  disabledReason?: string;
  /** The current reviewer's latest completion of this Series. */
  completion?: SeriesReviewCompletion;
  /** The current reviewer's explicit votes among the presented images. */
  ownVotes: { abnormal: number; uncertain: number; normal: number; unmarked: number };
}

/**
 * "Complete review": the current doctor reviewed the whole Series; every
 * image they did not mark is Normal according to their review (no votes are
 * created). Not a lock: decisions can be changed later, and completing again
 * covers images added since.
 */
export const CompleteSeriesReview: FC<CompleteSeriesReviewProps> = ({
  patientId,
  seriesId,
  presentedImageIds,
  disabledReason,
  completion,
  ownVotes,
}) => {
  const [open, toggleOpen] = useToggle(false);
  const { notifyError, notifySuccess } = useNotifications();
  const [completeSeriesReview, { isLoading }] = useCompleteSeriesReviewMutation();

  const onAgree = async () => {
    toggleOpen();
    try {
      const result = await completeSeriesReview({
        patientId,
        seriesId,
        presentedImageIds,
      }).unwrap();
      notifySuccess(
        `Review completed: ${result.explicitAbnormal} abnormal, ` +
          `${result.explicitUncertain} not sure, ${result.explicitNormal} normal (explicit); ` +
          `${result.implicitNormal} normal by default.`
      );
    } catch (error) {
      notifyError(error);
    }
  };

  const status = completion ? (
    completion.current ? (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        label={`You completed this review ${format(completion.completedAt, defaultDateFormat)}`}
      />
    ) : (
      <Tooltip title="Images were added after your completed review; they are not normal by default until you complete the review again.">
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label={`Completed ${format(completion.completedAt, defaultDateFormat)} · ${completion.uncoveredImageCount} new image(s) not reviewed`}
        />
      </Tooltip>
    )
  ) : null;

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Tooltip
        title={
          disabledReason ??
          'Every image you did not mark Abnormal or Not sure counts as Normal according to your review. You can still change any decision later.'
        }
      >
        <span>
          <Button
            variant="contained"
            startIcon={<DoneAllIcon />}
            disabled={!!disabledReason || isLoading}
            onClick={() => toggleOpen()}
          >
            {completion?.current ? 'Complete review again' : 'Complete review'}
          </Button>
        </span>
      </Tooltip>
      {status}
      <DialogAreYouSure
        open={open}
        title="Complete your review of this series?"
        onDisagree={toggleOpen}
        onAgree={onAgree}
      >
        <Typography>
          Your marks stay as they are: {ownVotes.abnormal} Abnormal,{' '}
          {ownVotes.uncertain} Not sure, {ownVotes.normal} Normal.
        </Typography>
        <Typography>
          The other {ownVotes.unmarked} image(s) will count as Normal according
          to your review. Other doctors' votes are not changed. You can still
          change any of your decisions later.
        </Typography>
      </DialogAreYouSure>
    </Stack>
  );
};
