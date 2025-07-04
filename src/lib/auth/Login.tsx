'use client';

import React, { useState } from 'react';
import { SubmitHandler } from 'react-hook-form';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Container, Typography, Alert, Stack } from '@mui/material';
import { encode } from 'next-auth/jwt';
import { LoginFormData, LoginForm } from './LoginForm';

export const Login: React.FC = () => {
  const router = useRouter();
  const [serverValidationError, setServerValidationError] = useState('');
  const [loading, setLoading] = useState(false);
  const onFormChange = () => {
    if (serverValidationError) {
      setServerValidationError('');
    }
  };
  const onSubmit: SubmitHandler<LoginFormData> = async (formData) => {
    try {
      setLoading(true);
      const token = await encode({
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        token: formData,
        secret: process.env.NEXT_PUBLIC_SECRET || '',
      });
      const res = await signIn('credentials', {
        redirect: false,
        token,
      });
      if (res?.ok) {
        router.push('/');
      } else {
        setServerValidationError(res?.error || 'Invalid credentials');
      }
    } catch (error) {
      setServerValidationError((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container
      maxWidth="xs"
      sx={{ height: '100%', display: 'flex', alignItems: 'center' }}
    >
      <Stack py={2} spacing={2}>
        <Typography component="h1" variant="h5" textAlign="center">
          Sign In
        </Typography>
        {!!serverValidationError && (
          <Alert severity="error">{serverValidationError}</Alert>
        )}
        <LoginForm
          onSubmit={onSubmit}
          loading={loading}
          onChange={onFormChange}
        />
      </Stack>
    </Container>
  );
};
