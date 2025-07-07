import { FC, startTransition, useActionState, useEffect } from 'react';
import DeleteIcon from '@mui/icons-material/Delete';
import { Fab, Tooltip } from '@mui/material';
import { DialogAreYouSure } from '@/lib/components';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { DeleteProfileActionStates } from './DeleteUserActionStates.enum';
import { DeleteProfileActionState, deleteProfile } from './deleteUser.action';
import { useToggle } from 'usehooks-ts';
import { useSession, signOut } from 'next-auth/react';
import { paths } from '@/lib/constants/paths';
import { UserRoles } from '@/types';

interface DeleteProfileProps {
  id: string;
}

export const DeleteProfile: FC<DeleteProfileProps> = ({ id }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const { data } = useSession();
  const [state, formAction] = useActionState<DeleteProfileActionState, string>(
    deleteProfile,
    {
      status: DeleteProfileActionStates.IDLE,
    }
  );
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction(id);
    });
  };
  useEffect(() => {
    if (state.status === DeleteProfileActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('Account do not exist!');
    } else if (state.status === DeleteProfileActionStates.FAILED) {
      notifyError('Failed to delete account!');
    } else if (state.status === DeleteProfileActionStates.UNABLE_TO_DELETE) {
      notifyError('Unable to delete account!');
    } else if (state.status === DeleteProfileActionStates.SUCCESS) {
      notifySuccess('Profile deleted successfully!');
      signOut({ callbackUrl: paths.login });
    }
    toggleOpen();
  }, [state]);

  if (data?.user.role === UserRoles.SUPER) {
    return null;
  }

  return (
    <>
      <Tooltip title="Delete account">
        <Fab color="error" onClick={toggleOpen}>
          <DeleteIcon />
        </Fab>
      </Tooltip>
      <DialogAreYouSure
        open={open}
        onDisagree={toggleOpen}
        onAgree={handleOnDeleteProfile}
      />
    </>
  );
};
