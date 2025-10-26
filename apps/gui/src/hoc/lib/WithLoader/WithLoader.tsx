import React, { JSX, ReactElement } from 'react';
import { Alert, LinearProgress } from '@mui/material';
import { SerializedError } from '@reduxjs/toolkit';
import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { getErrorMessage } from '../../../utils';

type WithLoaderError = FetchBaseQueryError | SerializedError | string;

type WithLoaderData<T> = { data: T };

export interface WithLoaderProps<T> {
  data?: T; // дані можуть бути undefined під час завантаження
  isLoading: boolean;
  isError: boolean;
  error?: WithLoaderError;
  errorComponent?: (
    errorMessage: string,
    error: WithLoaderError
  ) => ReactElement;
  LoadingComponent?: ReactElement | null;
}

/**
 * Оверлоад #1: коли додаткових пропсів немає
 */
export function WithLoader<T>(
  WrappedComponent: React.ComponentType<WithLoaderData<T>>
): (props: WithLoaderProps<T>) => JSX.Element | null;

/**
 * Оверлоад #2: коли є ще якісь пропси P
 */
export function WithLoader<T, P extends object>(
  WrappedComponent: React.ComponentType<P & WithLoaderData<T>>
): (props: P & WithLoaderProps<T>) => JSX.Element | null;

/**
 * Реалізація
 */
export function WithLoader<T, P extends object>(
  WrappedComponent: React.ComponentType<P & WithLoaderData<T>>
) {
  return ({
    isLoading,
    isError,
    errorComponent,
    LoadingComponent,
    error,
    ...wrappedComponentProps
  }: P & WithLoaderProps<T>) => {
    if (isLoading) {
      return LoadingComponent ?? <LinearProgress />;
    }

    if (isError) {
      const errorMessage =
        typeof error === 'string' ? error : getErrorMessage(error);
      if (errorComponent && error) {
        return errorComponent(errorMessage || '', error);
      }
      return <Alert severity="error">{errorMessage}</Alert>;
    }

    const { data } = wrappedComponentProps;
    if (data == null) return null;

    return (
      <WrappedComponent {...(wrappedComponentProps as P & WithLoaderData<T>)} />
    );
  };
}
