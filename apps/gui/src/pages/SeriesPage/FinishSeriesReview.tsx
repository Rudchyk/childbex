import { FC, useEffect } from 'react';
import { Button, Tooltip } from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { DialogAreYouSure } from '../../components';
import { useToggle } from '../../hooks';
import { useNotifications } from '../../modules/notifications';
import { useFinishSeriesReviewMutation } from '../../store/apis';

interface FinishSeriesReviewProps {
  patientId: string;
  seriesId: string;
  /** Exactly the images handed to (and loaded by) the viewer. */
  presentedImageIds: string[];
  /** Why the series cannot be finished now (disables the button). */
  disabledReason?: string;
}

/**
 * Completes the untouched images of the Series as NORMAL. The server checks
 * again that the Series is one complete stack and that the presented images
 * are all of its images.
 */
export const FinishSeriesReview: FC<FinishSeriesReviewProps> = ({
  patientId,
  seriesId,
  presentedImageIds,
  disabledReason,
}) => {
  const [open, toggleOpen] = useToggle(false);
  const { notifyError, notifySuccess } = useNotifications();
  const [finishSeriesReview, { data, isLoading, isError, isSuccess, error }] =
    useFinishSeriesReviewMutation();

  useEffect(() => {
    if (isError) notifyError(error);
  }, [isError]);
  useEffect(() => {
    if (isSuccess && data) {
      notifySuccess(
        `Review finished: ${data.completed} image(s) marked normal, ` +
          `${data.alreadyReviewed} already reviewed.`
      );
    }
  }, [isSuccess]);

  const onAgree = () => {
    toggleOpen();
    finishSeriesReview({ patientId, seriesId, presentedImageIds });
  };

  return (
    <>
      <Tooltip title={disabledReason ?? 'Mark every image without a vote as normal'}>
        <span>
          <Button
            variant="contained"
            startIcon={<DoneAllIcon />}
            disabled={!!disabledReason || isLoading}
            onClick={() => toggleOpen()}
          >
            Finish review
          </Button>
        </span>
      </Tooltip>
      <DialogAreYouSure open={open} onDisagree={toggleOpen} onAgree={onAgree} />
    </>
  );
};
