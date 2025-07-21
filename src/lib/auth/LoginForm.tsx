'use client';

import React, { FC, FormEventHandler } from 'react';
import { SubmitHandler, SubmitErrorHandler, useForm } from 'react-hook-form';
import { Box, Button } from '@mui/material';
import { FormUITextField, FormUIPasswordField } from '../../lib/components';
import {
  LoginFormData,
  loginFormSchema,
} from '../../lib/auth/loginForm.schema';
import { yupResolver } from '@hookform/resolvers/yup';

export * from '../../lib/auth/loginForm.schema';

export interface LoginFormProps {
  onSubmit: SubmitHandler<LoginFormData>;
  loading?: boolean;
  onError?: SubmitErrorHandler<LoginFormData>;
  onChange?: FormEventHandler<HTMLFormElement>;
}

export const LoginForm: FC<LoginFormProps> = ({
  onSubmit,
  onError,
  onChange,
  loading,
}) => {
  const { handleSubmit, control } = useForm<LoginFormData>({
    resolver: yupResolver(loginFormSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });
  return (
    <Box
      component="form"
      onChange={onChange}
      onSubmit={handleSubmit(onSubmit, onError)}
      width="100%"
    >
      <FormUITextField
        label="Email"
        name="email"
        control={control}
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
      <Button
        sx={{ mt: 2 }}
        loading={loading}
        type="submit"
        fullWidth
        variant="contained"
      >
        Sign In
      </Button>
    </Box>
  );
};
