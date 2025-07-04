'use client';

import { FC } from 'react';
import { useGetHelloQuery } from '@/lib/store/services/apiService';
import { Alert, CircularProgress } from '@mui/material';

export const APIHello: FC = () => {
  const { data, isLoading, isError, error } = useGetHelloQuery();

  if (isLoading) {
    return <CircularProgress />;
  }

  if (isError) {
    return <Alert severity="error">{(error as Error)?.message}</Alert>;
  }

  return <Alert severity="success">{data?.message}</Alert>;
};
