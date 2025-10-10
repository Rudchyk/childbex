import { useSnackbar } from 'notistack';

export const useNotifications = () => {
  const { enqueueSnackbar } = useSnackbar();

  const notifySuccess = (msg?: string) =>
    enqueueSnackbar(msg, { variant: 'success' });
  const notifyError = (msg?: string) =>
    enqueueSnackbar(msg, { variant: 'error' });
  const notifyInfo = (msg?: string) =>
    enqueueSnackbar(msg, { variant: 'info' });
  const notifyWarning = (msg?: string) =>
    enqueueSnackbar(msg, { variant: 'warning' });

  return {
    notifySuccess,
    notifyError,
    notifyInfo,
    notifyWarning,
  };
};
