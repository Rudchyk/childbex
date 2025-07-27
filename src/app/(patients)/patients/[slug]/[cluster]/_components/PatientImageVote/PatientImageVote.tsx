import { useNotifications } from '@/lib/modules/NotificationsModule';
import { PatientImageReviewVote, PatientImageReviewVoteTypes } from '@/types';
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
import {
  FC,
  startTransition,
  useActionState,
  useEffect,
  useState,
} from 'react';
import { PatientImageVoteActionStates } from './PatientImageVoteActionStates.enum';
import {
  patientImageVote,
  PatientImageVoteActionState,
  PatientImageVoteData,
} from './patientImageVote.actions';
import { useRouter } from 'next/navigation';

interface PatientImageVoteProps {
  patientImageId: string;
  userVote?: PatientImageReviewVote;
}

export const PatientImageVote: FC<PatientImageVoteProps> = ({
  patientImageId,
  userVote,
}) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [vote, setVote] = useState(PatientImageReviewVoteTypes.NORMAL);
  const [comment, setComment] = useState('');
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [state, formAction] = useActionState<
    PatientImageVoteActionState,
    PatientImageVoteData
  >(patientImageVote, {
    status: PatientImageVoteActionStates.IDLE,
  });
  const onSubmit = async () => {
    setLoading(true);
    const data = {
      id: userVote?.id,
      patientImageId,
      vote,
      comment,
    };
    startTransition(() => {
      return formAction(data);
    });
  };
  useEffect(() => {
    switch (state.status) {
      case PatientImageVoteActionStates.DO_NOT_EXIST:
        notifyWarning('Image do not exist!');
        break;
      case PatientImageVoteActionStates.FAILED:
        notifyError('Failed to updated vote!');
        console.error(state.message);
        break;
      case PatientImageVoteActionStates.NOTHING_TO_UPDATE:
        notifyWarning('Nothing to update!');
        break;
      case PatientImageVoteActionStates.UNABLE_TO_UPDATE:
        notifyWarning('Unable to update!');
        break;
      case PatientImageVoteActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case PatientImageVoteActionStates.SUCCESS:
        notifySuccess('Vote updated successfully!');
        router.refresh();
        // window.location.reload();
        break;
      default:
        break;
    }
    if (state.status !== PatientImageVoteActionStates.IDLE) {
      setLoading(false);
    }
  }, [state]);

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
      <Button loading={loading} variant="contained" onClick={onSubmit}>
        Vote
      </Button>
    </Stack>
  );
};
