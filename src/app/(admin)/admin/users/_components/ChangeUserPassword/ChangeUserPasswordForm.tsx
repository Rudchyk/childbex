'use client';

import React, { FC } from 'react';
import { SubmitHandler, SubmitErrorHandler, useForm } from 'react-hook-form';
import { Box } from '@mui/material';
import { FormUIPasswordField } from '../../../../../../lib/components';
import {
  changeUserPasswordFormSchema,
  ChangeUserPasswordFormData,
} from './changeUserPassword.schema';
import { yupResolver } from '@hookform/resolvers/yup';

export interface ChangeUserPasswordFormProps {
  onSubmit: SubmitHandler<ChangeUserPasswordFormData>;
  loading?: boolean;
  onError?: SubmitErrorHandler<ChangeUserPasswordFormData>;
}

export const ChangeUserPasswordForm: FC<ChangeUserPasswordFormProps> = ({
  onSubmit,
  onError,
}) => {
  const { handleSubmit, control } = useForm<ChangeUserPasswordFormData>({
    resolver: yupResolver(changeUserPasswordFormSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });
  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit, onError)}>
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
