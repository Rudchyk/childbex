import { useNotifications } from '../../../../../lib/modules/NotificationsModule';
import { FC, startTransition, useActionState, useEffect } from 'react';
import {
  changePasswordProfile,
  ChangePasswordProfileActionState,
  ChangePasswordProfileData,
} from './changePasswordProfile.actions';
import { ChangePasswordProfileActionStates } from './ChangePasswordProfileActionStates.enum';
import { ChangePasswordProfileFormData } from './changePasswordProfile.schema';
import { useToggle } from 'usehooks-ts';
import { signOut } from 'next-auth/react';
import { paths } from '../../../../../lib/constants/paths';
import { Button } from '@mui/material';
import { DialogForm } from '../../../../../lib/components';
import { ChangePasswordProfileForm } from './ChangePasswordProfileForm';
import { encode } from 'next-auth/jwt';
import { SubmitHandler } from 'react-hook-form';

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
  const handleOnResetPassword: SubmitHandler<
    ChangePasswordProfileFormData
  > = async (formData) => {
    const token = await encode({
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore
      token: formData,
      secret: process.env.NEXT_PUBLIC_SECRET || '',
    });
    startTransition(() => {
      formAction({ id, token });
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
    } else if (
      state.status === ChangePasswordProfileActionStates.INVALID_DATA
    ) {
      notifyError(`Failed validating your submission! ${state.message}`);
    } else if (state.status === ChangePasswordProfileActionStates.SUCCESS) {
      notifySuccess('Password updated successfully!');
      signOut({ callbackUrl: paths.login });
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Button variant="contained" onClick={toggleOpen}>
        Change password
      </Button>
      <DialogForm
        title="Change password"
        open={open}
        onDialogClose={toggleOpen}
        form={<ChangePasswordProfileForm onSubmit={handleOnResetPassword} />}
      />
    </>
  );
};
