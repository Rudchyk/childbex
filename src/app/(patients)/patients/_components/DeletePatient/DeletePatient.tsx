import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '../../../../../lib/components';
import { useNotifications } from '../../../../../lib/modules/NotificationsModule';
import { DeletePatientActionStates } from './DeletePatientActionStates.enum';
import {
  DeleteProfileActionState,
  deleteProfile,
} from './deletePatient.action';
import { useToggle } from 'usehooks-ts';
import { useRouter } from 'next/navigation';
import { GridActionsCellItem } from '@mui/x-data-grid';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';

interface DeletePatientProps {
  id: string;
}

export const DeletePatient: FC<DeletePatientProps> = ({ id }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const router = useRouter();
  const [state, formAction] = useActionState<DeleteProfileActionState, string>(
    deleteProfile,
    {
      status: DeletePatientActionStates.IDLE,
    }
  );
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction(id);
    });
  };
  useEffect(() => {
    switch (state.status) {
      case DeletePatientActionStates.PATIENT_DO_NOT_EXIST:
        notifyWarning('Patient does not exist!');
        break;
      case DeletePatientActionStates.FAILED:
        notifyError('Failed to delete patient!');
        break;
      case DeletePatientActionStates.SUCCESS:
        notifySuccess('Patient was deleted successfully!');
        router.refresh();
        break;
      default:
        break;
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Tooltip title="Delete patient">
        <GridActionsCellItem
          onClick={toggleOpen}
          icon={<DeleteForeverIcon />}
          label="Delete"
          style={{ color: theme.palette.error.main }}
        />
      </Tooltip>
      <DialogAreYouSure
        open={open}
        onDisagree={toggleOpen}
        onAgree={handleOnDeleteProfile}
      />
    </>
  );
};
