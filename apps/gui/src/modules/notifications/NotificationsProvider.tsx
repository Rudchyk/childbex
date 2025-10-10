import { FC } from 'react';
import { SnackbarProvider, SnackbarProviderProps } from 'notistack';

export interface NotificationsProviderProps extends SnackbarProviderProps {
  children: React.ReactNode;
}

export const NotificationsProvider: FC<NotificationsProviderProps> = ({
  children,
  ...snackbarProviderProps
}) => {
  return (
    <SnackbarProvider {...snackbarProviderProps}>{children}</SnackbarProvider>
  );
};
