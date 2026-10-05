import { FC } from 'react';
import { Button, Stack, Typography } from '@mui/material';
import { PatientImageReviewVoteTypes } from '@libs/schemas';
import { useNotifications } from '../../../modules/notifications';
import { useBulkReviewVoteMutation } from '../../../store/apis';
import { bulkVoteOrder, opinionLabels } from './reviewOpinions';

interface BulkReviewActionsProps {
  patientId: string;
  seriesId: string;
  /** Selected image ids (list order). */
  selectedIds: string[];
  /** After a saved bulk vote (clears the selection). */
  onSaved: () => void;
}

const buttonColor: Record<PatientImageReviewVoteTypes, 'success' | 'error' | 'warning'> = {
  [PatientImageReviewVoteTypes.NORMAL]: 'success',
  [PatientImageReviewVoteTypes.ABNORMAL]: 'error',
  [PatientImageReviewVoteTypes.UNCERTAIN]: 'warning',
};

/**
 * Normal / Abnormal / Not sure for every selected slice: one atomic request
 * (the server changes only the current doctor's votes). On failure nothing
 * is shown as saved and the selection stays for a retry.
 */
export const BulkReviewActions: FC<BulkReviewActionsProps> = ({
  patientId,
  seriesId,
  selectedIds,
  onSaved,
}) => {
  const [bulkReviewVote, { isLoading }] = useBulkReviewVoteMutation();
  const { notifyError, notifySuccess } = useNotifications();

  if (!selectedIds.length) return null;

  const onVote = async (vote: PatientImageReviewVoteTypes) => {
    try {
      const result = await bulkReviewVote({
        patientId,
        seriesId,
        imageIds: selectedIds,
        vote,
      }).unwrap();
      notifySuccess(
        `${opinionLabels[vote]} saved for ${result.requested} slice(s)` +
          ` (${result.created} new, ${result.changed} changed, ${result.unchanged} unchanged).`
      );
      onSaved();
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <Stack
      spacing={0.5}
      sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      data-testid="bulk-review-actions"
    >
      <Typography variant="caption">
        Your vote for {selectedIds.length} selected slice(s):
      </Typography>
      <Stack direction="row" spacing={0.5}>
        {bulkVoteOrder.map((vote) => (
          <Button
            key={vote}
            size="small"
            variant="contained"
            color={buttonColor[vote]}
            disabled={isLoading}
            onClick={() => onVote(vote)}
          >
            {opinionLabels[vote]}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
};
