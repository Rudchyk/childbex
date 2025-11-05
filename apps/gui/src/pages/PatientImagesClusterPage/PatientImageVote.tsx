import {
  GetPatientClusterResponse,
  PatientImageReviewVoteTypes,
} from '@libs/schemas';
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
import { startCase } from 'lodash';
import { FC, useEffect, useState } from 'react';
import { useNotifications } from '../../modules/notifications';
import {
  useUpdatePatientImageReviewVoteMutation,
  useAddPatientImageReviewVoteMutation,
} from '../../store/apis';

interface PatientImageVoteProps {
  patientImageId: string;
  userVote?: GetPatientClusterResponse['images'][0]['votes'][0];
}

export const PatientImageVote: FC<PatientImageVoteProps> = ({
  patientImageId,
  userVote,
}) => {
  const [vote, setVote] = useState(PatientImageReviewVoteTypes.NORMAL);
  const [comment, setComment] = useState('');
  const [updatePatientImageReviewVote, updatePatientImageReviewVoteState] =
    useUpdatePatientImageReviewVoteMutation();
  const [addPatientImageReviewVote, addPatientImageReviewVoteState] =
    useAddPatientImageReviewVoteMutation();
  const { notifyError, notifySuccess } = useNotifications();
  const onSubmit = async () => {
    const data = {
      id: patientImageId,
      vote,
      comment,
    };
    if (userVote?.id) {
      updatePatientImageReviewVote({
        voteId: userVote.id,
        ...data,
      });
    } else {
      addPatientImageReviewVote(data);
    }
  };

  useEffect(() => {
    if (userVote) {
      setComment(userVote.comment || '');
      setVote(userVote.vote);
    }

    return () => {
      setComment('');
      setVote(PatientImageReviewVoteTypes.NORMAL);
    };
  }, [userVote]);

  useEffect(() => {
    if (addPatientImageReviewVoteState.isError) {
      notifyError(addPatientImageReviewVoteState.error);
    }
  }, [addPatientImageReviewVoteState.isError]);

  useEffect(() => {
    if (addPatientImageReviewVoteState.isSuccess) {
      notifySuccess(`Vote was added successfully!`);
    }
  }, [addPatientImageReviewVoteState.isSuccess]);

  useEffect(() => {
    if (updatePatientImageReviewVoteState.isError) {
      notifyError(updatePatientImageReviewVoteState.error);
    }
  }, [updatePatientImageReviewVoteState.isError]);

  useEffect(() => {
    if (updatePatientImageReviewVoteState.isSuccess) {
      notifySuccess(`Vote was updated successfully!`);
    }
  }, [updatePatientImageReviewVoteState.isSuccess]);

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
              label={startCase(value)}
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
        loading={
          updatePatientImageReviewVoteState.isLoading ||
          addPatientImageReviewVoteState.isLoading
        }
        variant="contained"
        onClick={onSubmit}
      >
        Vote
      </Button>
    </Stack>
  );
};
