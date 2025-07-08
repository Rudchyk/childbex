'use client';

import { Tooltip } from '@mui/material';
import { ToolbarButton, Toolbar } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from 'usehooks-ts';
import { DialogForm } from '@/lib/components';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { startTransition, useActionState, useEffect } from 'react';
import { AddUserActionStates } from './AddUserActionStates.enum';
import { addUser, AddUserActionState } from './addUser.actions';
import { SubmitHandler } from 'react-hook-form';
import { AddUserFormData } from './addUserForm.schema';
import { encode } from 'next-auth/jwt';
import { AddAccountForm } from './AddUserForm';
import { useRouter } from 'next/navigation';

export const AddUser = () => {
  const title = 'Add user';
  const router = useRouter();
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const [state, formAction] = useActionState<AddUserActionState, string>(
    addUser,
    {
      status: AddUserActionStates.IDLE,
    }
  );
  const onSubmit: SubmitHandler<AddUserFormData> = async (formData) => {
    const token = await encode({
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore
      token: formData,
      secret: process.env.NEXT_PUBLIC_SECRET || '',
    });
    startTransition(() => {
      return formAction(token);
    });
  };
  useEffect(() => {
    switch (state.status) {
      case AddUserActionStates.USER_EXISTS:
        notifyWarning('User already exists!');
        break;
      case AddUserActionStates.FAILED:
        notifyError(`Failed to create user! ${state.message}`);
        break;
      case AddUserActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case AddUserActionStates.USER_IN_TRASH:
        notifyError(`User in trash, please, restore it!`);
        break;
      case AddUserActionStates.SUCCESS:
        notifySuccess('Users created successfully!');
        router.refresh();
        break;
      default:
        break;
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Toolbar>
        <Tooltip title={title}>
          <ToolbarButton onClick={toggleOpen}>
            <AddIcon fontSize="small" />
          </ToolbarButton>
        </Tooltip>
      </Toolbar>
      <DialogForm
        title={title}
        open={open}
        onDialogClose={toggleOpen}
        form={<AddAccountForm onSubmit={onSubmit} />}
      />
    </>
  );
};
