import { useSnackbar } from 'notistack';
import { getErrorMessage } from '../../utils';

export const useNotifications = () => {
  const { enqueueSnackbar } = useSnackbar();

  const notifySuccess = (msg?: string) =>
    enqueueSnackbar(msg, { variant: 'success' });
  const notifyError = (err?: unknown) =>
    enqueueSnackbar(getErrorMessage(err), { variant: 'error' });
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
