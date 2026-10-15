import { PatientImageReviewVoteTypes, SeriesImage } from '@libs/schemas';
import {
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
} from '@mui/material';
import { FC, useEffect, useState } from 'react';
import { useNotifications } from '../../../modules/notifications';
import {
  useUpdatePatientImageReviewVoteMutation,
  useAddPatientImageReviewVoteMutation,
} from '../../../store/apis';
import { getErrorMessage } from '../../../utils';
import { useAuth } from '../../../auth/useAuth';
import { opinionLabels } from './reviewOpinions';

interface PatientImageVoteProps {
  patientImageId: string;
  userVote?: SeriesImage['votes'][number];
  /**
   * Names the image in notifications: they may appear after another image
   * is shown.
   */
  targetLabel?: string;
}

/**
 * The current reviewer's vote on one image. Render it keyed by reviewer and
 * image: the choice and the unsaved comment belong to that pair only.
 */
export const PatientImageVote: FC<PatientImageVoteProps> = ({
  patientImageId,
  userVote,
  targetLabel,
}) => {
  const [vote, setVote] = useState(
    userVote?.vote ?? PatientImageReviewVoteTypes.NORMAL
  );
  const [comment, setComment] = useState(userVote?.comment ?? '');
  const { userId } = useAuth();
  // Per reviewer and image, shared by every mount of its form: a vote still
  // being saved is shown as pending when the image is shown again, never to
  // another reviewer and never on another image.
  const fixedCacheKey = `review-vote:${userId ?? 'anonymous'}:${patientImageId}`;
  const [updatePatientImageReviewVote, updatePatientImageReviewVoteState] =
    useUpdatePatientImageReviewVoteMutation({ fixedCacheKey });
  const [addPatientImageReviewVote, addPatientImageReviewVoteState] =
    useAddPatientImageReviewVoteMutation({ fixedCacheKey });
  const isSaving =
    updatePatientImageReviewVoteState.isLoading ||
    addPatientImageReviewVoteState.isLoading;
  const { notifyError, notifySuccess } = useNotifications();

  const onSubmit = async () => {
    // Fixed at the click: this form's image, whichever image is shown when
    // the request ends.
    const label = targetLabel ?? 'the image';
    const data = {
      id: patientImageId,
      vote,
      comment,
    };
    const voteId = userVote?.id;
    try {
      if (voteId) {
        await updatePatientImageReviewVote({ voteId, ...data }).unwrap();
        notifySuccess(`Vote updated: ${label}`);
      } else {
        await addPatientImageReviewVote(data).unwrap();
        notifySuccess(`Vote added: ${label}`);
      }
    } catch (error) {
      notifyError(`Vote not saved (${label}): ${getErrorMessage(error)}`);
    }
  };

  // Shows the saved vote when it changes (after a save, a bulk vote, or
  // when it is gone: the Normal default and no comment); a refetched copy
  // of the same vote keeps unsaved edits.
  const savedVoteId = userVote?.id;
  const savedVote = userVote?.vote;
  const savedComment = userVote?.comment ?? '';
  useEffect(() => {
    setVote(savedVote ?? PatientImageReviewVoteTypes.NORMAL);
    setComment(savedComment);
  }, [savedVoteId, savedVote, savedComment]);

  return (
    <Stack sx={{ px: 2 }} spacing={1}>
      <FormControl>
        <FormLabel id="vote-label">Vote</FormLabel>
        <RadioGroup
          aria-labelledby="vote-label"
          value={vote}
          onChange={(e, value) => setVote(value as PatientImageReviewVoteTypes)}
        >
          {Object.values(PatientImageReviewVoteTypes).map((value) => (
            <FormControlLabel
              key={value}
              value={value}
              control={<Radio />}
              label={opinionLabels[value]}
            />
          ))}
        </RadioGroup>
      </FormControl>
      <TextField
        label="Comment"
        value={comment}
        fullWidth
        multiline
        rows={3}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button
        loading={isSaving}
        variant="contained"
        onClick={onSubmit}
      >
        Vote
      </Button>
    </Stack>
  );
};
