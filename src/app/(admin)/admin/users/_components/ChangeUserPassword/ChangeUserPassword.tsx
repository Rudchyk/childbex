import { useNotifications } from '@/lib/modules/NotificationsModule';
import { FC, startTransition, useActionState, useEffect } from 'react';
import {
  changeUserPassword,
  ChangeUserPasswordActionState,
  ChangeUserPasswordData,
} from './changeUserPassword.actions';
import { ChangeUserPasswordActionStates } from './ChangeUserPasswordActionStates.enum';
import { ChangeUserPasswordFormData } from './changeUserPassword.schema';
import { useToggle } from 'usehooks-ts';
import { Button } from '@mui/material';
import { DialogForm } from '@/lib/components';
import { ChangeUserPasswordForm } from './ChangeUserPasswordForm';
import { encode } from 'next-auth/jwt';
import { SubmitHandler } from 'react-hook-form';

interface ChangeUserPasswordProps {
  id: string;
}

export const ChangeUserPassword: FC<ChangeUserPasswordProps> = ({ id }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const [state, formAction] = useActionState<
    ChangeUserPasswordActionState,
    ChangeUserPasswordData
  >(changeUserPassword, {
    status: ChangeUserPasswordActionStates.IDLE,
  });
  const handleOnResetPassword: SubmitHandler<
    ChangeUserPasswordFormData
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
    switch (state.status) {
      case ChangeUserPasswordActionStates.USER_DO_NOT_EXIST:
        notifyWarning('Account do not exist!');
        break;
      case ChangeUserPasswordActionStates.FAILED:
        notifyError('Failed to update password');
        break;
      case ChangeUserPasswordActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case ChangeUserPasswordActionStates.SUCCESS:
        notifySuccess('Password updated successfully!');
        break;
      default:
        break;
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Button color="warning" variant="contained" onClick={toggleOpen}>
        Change password
      </Button>
      <DialogForm
        title="Change password"
        open={open}
        onDialogClose={toggleOpen}
        form={<ChangeUserPasswordForm onSubmit={handleOnResetPassword} />}
      />
    </>
  );
};
