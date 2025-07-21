import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '../../../../../../lib/components';
import { useNotifications } from '../../../../../../lib/modules/NotificationsModule';
import { DeleteUserActionStates } from './DeleteUserActionStates.enum';
import { DeleteProfileActionState, deleteProfile } from './deleteUser.action';
import { useToggle } from 'usehooks-ts';
import { useRouter } from 'next/navigation';
import { GridActionsCellItem } from '@mui/x-data-grid';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';

interface DeleteUserProps {
  id: string;
}

export const DeleteUser: FC<DeleteUserProps> = ({ id }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const router = useRouter();
  const [state, formAction] = useActionState<DeleteProfileActionState, string>(
    deleteProfile,
    {
      status: DeleteUserActionStates.IDLE,
    }
  );
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction(id);
    });
  };
  useEffect(() => {
    if (state.status === DeleteUserActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('User does not exist!');
    } else if (state.status === DeleteUserActionStates.FAILED) {
      notifyError('Failed to delete user!');
    } else if (state.status === DeleteUserActionStates.UNABLE_TO_DELETE) {
      notifyError('Unable to delete user!');
    } else if (state.status === DeleteUserActionStates.SUCCESS) {
      notifySuccess('User was deleted successfully!');
      router.refresh();
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Tooltip title="Delete account">
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
