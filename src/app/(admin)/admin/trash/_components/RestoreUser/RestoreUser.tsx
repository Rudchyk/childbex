import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '@/lib/components';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { RestoreUserActionStates } from './RestoreUserActionStates.enum';
import { RestoreUserActionState, restoreUser } from './restoreUser.action';
import { useToggle } from 'usehooks-ts';
import { useRouter } from 'next/navigation';
import { GridActionsCellItem } from '@mui/x-data-grid';
import RestoreIcon from '@mui/icons-material/Restore';

interface RestoreUserProps {
  id: string;
}

export const RestoreUser: FC<RestoreUserProps> = ({ id }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const router = useRouter();
  const [state, formAction] = useActionState<RestoreUserActionState, string>(
    restoreUser,
    {
      status: RestoreUserActionStates.IDLE,
    }
  );
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction(id);
    });
  };
  useEffect(() => {
    if (state.status === RestoreUserActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('User do not exist!');
    } else if (state.status === RestoreUserActionStates.FAILED) {
      notifyError('Failed to restore user!');
    } else if (state.status === RestoreUserActionStates.UNABLE_TO_RESTORE) {
      notifyError('Unable to restore user!');
    } else if (state.status === RestoreUserActionStates.SUCCESS) {
      notifySuccess('User was restored successfully!');
      router.refresh();
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Tooltip title="Restore account">
        <GridActionsCellItem
          onClick={toggleOpen}
          icon={<RestoreIcon />}
          label="Restore"
          style={{ color: theme.palette.primary.main }}
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
