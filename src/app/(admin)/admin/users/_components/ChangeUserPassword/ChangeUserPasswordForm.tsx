'use client';

import React, { FC } from 'react';
import { SubmitHandler, SubmitErrorHandler, useForm } from 'react-hook-form';
import { Box } from '@mui/material';
import { FormUIPasswordField } from '@/lib/components';
import {
  changePasswordProfileFormSchema,
  ChangePasswordProfileFormData,
} from './changeUserPassword.schema';
import { yupResolver } from '@hookform/resolvers/yup';

export interface ChangePasswordProfileFormProps {
  onSubmit: SubmitHandler<ChangePasswordProfileFormData>;
  loading?: boolean;
  onError?: SubmitErrorHandler<ChangePasswordProfileFormData>;
}

export const ChangePasswordProfileForm: FC<ChangePasswordProfileFormProps> = ({
  onSubmit,
  onError,
}) => {
  const { handleSubmit, control } = useForm<ChangePasswordProfileFormData>({
    resolver: yupResolver(changePasswordProfileFormSchema),
    defaultValues: {
      oldPassword: '',
      password: '',
      confirmPassword: '',
    },
  });
  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
      <FormUIPasswordField
        name="oldPassword"
        control={control}
        label="Old password"
        margin="normal"
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
