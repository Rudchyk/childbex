'use client';

import { yupResolver } from '@hookform/resolvers/yup';
import { SubmitErrorHandler, SubmitHandler, useForm } from 'react-hook-form';
import { FC } from 'react';

import {
  FormUIPasswordField,
  FormUITextField,
  FormUISelect,
} from '@/lib/components';
import { addUserFormDataSchema, AddUserFormData } from './addUserForm.schema';
import { UserRoles } from '@/types';
import { Box } from '@mui/material';
import { roleValues } from '@/lib/constants/roleValues';

interface AddAccountFormProps {
  onSubmit: SubmitHandler<AddUserFormData>;
  onError?: SubmitErrorHandler<AddUserFormData>;
}

export const AddAccountForm: FC<AddAccountFormProps> = ({
  onSubmit,
  onError,
}) => {
  const methods = useForm({
    resolver: yupResolver(addUserFormDataSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
      role: UserRoles.USER,
    },
  });
  const { handleSubmit, control } = methods;

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
      <FormUITextField
        name="name"
        control={control}
        label="Name"
        margin="normal"
        fullWidth
      />
      <FormUITextField
        name="email"
        control={control}
        label="Email"
        margin="normal"
        fullWidth
      />
      <FormUISelect
        name="role"
        control={control}
        label="Role"
        margin="normal"
        options={roleValues.map((item) => ({
          value: item,
          label: item.toUpperCase(),
        }))}
        fullWidth
      />
      <FormUIPasswordField
        name="password"
        control={control}
        label="Password"
        margin="normal"
        fullWidth
      />
      <FormUIPasswordField
        name="confirmPassword"
        control={control}
        label="Confirm Password"
        margin="normal"
        fullWidth
      />
    </Box>
  );
};
