import { useNotifications } from '@/lib/modules/NotificationsModule';
import { FC, startTransition, useActionState, useEffect } from 'react';
import {
  changePasswordProfile,
  ChangePasswordProfileActionState,
  ChangePasswordProfileData,
} from './changePasswordProfile.actions';
import { ChangePasswordProfileActionStates } from './ChangePasswordProfileActionStates.enum';
import { useToggle } from 'usehooks-ts';
import { signOut } from 'next-auth/react';
import { paths } from '@/lib/constants/paths';
import { Button } from '@mui/material';
import { DialogForm } from '@/lib/components';

interface ChangePasswordProfileProps {
  id: string;
}

export const ChangePasswordProfile: FC<ChangePasswordProfileProps> = ({
  id,
}) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const [state, formAction] = useActionState<
    ChangePasswordProfileActionState,
    ChangePasswordProfileData
  >(changePasswordProfile, {
    status: ChangePasswordProfileActionStates.IDLE,
  });
  const handleOnResetPassword = () => {
    console.log(111);
    startTransition(() => {
      formAction({ id, token: '' });
    });
  };
  useEffect(() => {
    if (state.status === ChangePasswordProfileActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('Account do not exist!');
    } else if (state.status === ChangePasswordProfileActionStates.FAILED) {
      notifyError('Failed to update password');
    } else if (
      state.status === ChangePasswordProfileActionStates.OLD_PASSWORD_IS_WRONG
    ) {
      notifyError('Old password is wrong!');
    } else if (state.status === ChangePasswordProfileActionStates.SUCCESS) {
      notifySuccess('Password updated successfully!');
      signOut({ callbackUrl: paths.login });
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Button color="warning" variant="contained" onClick={toggleOpen}>
        Reset password
      </Button>
      <DialogForm
        title="Reset password"
        open={open}
        onDialogClose={toggleOpen}
        onButtonClick={handleOnResetPassword}
        form={<></>}
      />
    </>
  );
};
