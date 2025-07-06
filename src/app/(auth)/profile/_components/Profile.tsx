'use client';

import { PublicUser } from '@/types';
import { Chip, Grid, Stack, TextField, Typography } from '@mui/material';
import {
  FC,
  FormEventHandler,
  startTransition,
  useActionState,
  useEffect,
  useState,
} from 'react';
import { EditEmailProfileForm } from './EditProfile/EditEmailProfileForm';
import { EditNameProfileForm } from './EditProfile/EditNameProfileForm';
import { SubmitHandler } from 'react-hook-form';
import { format } from 'date-fns';
import { EditProfileActionStates } from './EditProfile/EditProfileActionStates.enum';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { DeleteProfile } from './DeleteProfile/DeleteProfile';
import { ChangePasswordProfile } from './ChangePasswordProfile/ChangePasswordProfile';
import {
  EditProfileActionState,
  EditProfileData,
  editProfile,
} from './EditProfile/editProfile.actions';

interface ProfileProps {
  data: PublicUser;
}

export const Profile: FC<ProfileProps> = ({ data }) => {
  const { createdAt, role, id, email } = data;
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(data.name);
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [state, formAction] = useActionState<
    EditProfileActionState,
    EditProfileData
  >(editProfile, {
    status: EditProfileActionStates.IDLE,
  });
  const handleOnSubmitEditProfileForm: SubmitHandler<
    EditProfileData['data']
  > = (data) => {
    startTransition(() => {
      formAction({ id, data });
    });
  };
  const handleOnChangeEditNameProfileForm: FormEventHandler<HTMLFormElement> = (
    e
  ) => {
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = data.get('name');
    if (name) {
      setName(name as string);
    }
  };
  const infoList = [
    { value: id, label: 'ID' },
    {
      value: createdAt ? format(createdAt, 'dd-MM-yyyy, HH:mm:ss') : '',
      label: 'Created at',
    },
  ];
  useEffect(() => {
    if (state.status !== EditProfileActionStates.SUCCESS) {
      setLoading(false);
    }
    if (state.status === EditProfileActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('Account do not exist!');
    } else if (state.status === EditProfileActionStates.FAILED) {
      notifyError('Failed to updated account!');
    } else if (state.status === EditProfileActionStates.INVALID_DATA) {
      notifyError(`Failed validating your submission! ${state.message}`);
    } else if (state.status === EditProfileActionStates.SUCCESS) {
      notifySuccess('Profile updated successfully!');
    }
  }, [state]);

  return (
    <Stack spacing={2}>
      <Typography variant="h1">{name}</Typography>
      <Grid container spacing={2}>
        <Grid size={6}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h5">Role:</Typography>
            <Chip label={role.toUpperCase()} />
          </Stack>
        </Grid>
        <Grid size={6}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="end"
            spacing={2}
          >
            <ChangePasswordProfile id={id} />
            <DeleteProfile id={id} />
          </Stack>
        </Grid>
        {infoList.map(({ value, label }) => (
          <Grid size={6} key={label}>
            <TextField
              disabled
              label={label}
              margin="normal"
              fullWidth
              value={value}
            />
          </Grid>
        ))}
        <Grid size={6}>
          <EditNameProfileForm
            onSubmit={handleOnSubmitEditProfileForm}
            onChange={handleOnChangeEditNameProfileForm}
            value={data.name}
            loading={loading}
          />
        </Grid>
        <Grid size={6}>
          <EditEmailProfileForm
            onSubmit={handleOnSubmitEditProfileForm}
            value={email}
            loading={loading}
          />
        </Grid>
      </Grid>
    </Stack>
  );
};
