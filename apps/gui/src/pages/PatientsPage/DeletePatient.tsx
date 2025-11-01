import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '../../components';
import { GridActionsCellItem } from '@mui/x-data-grid';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { useNotifications } from '../../modules/notifications';
import { useToggle } from '../../hooks';
import { useDeletePatientMutation } from '../../store/apis';
import { getErrorMessage } from '../../utils';

interface DeletePatientProps {
  id: string;
}

export const DeletePatient: FC<DeletePatientProps> = ({ id }) => {
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const [deletePatient, { data, isLoading, isSuccess, isError, error }] =
    useDeletePatientMutation();
  const handleOnDeleteProfile = () => {
    deletePatient({ id });
  };
  useEffect(() => {
    if (isError) {
      notifyError(getErrorMessage(error));
    }
    toggleOpen();
  }, [isError]);

  useEffect(() => {
    if (isSuccess) {
      notifySuccess(`User ${data.name} was deleted successfully!`);
    }
    toggleOpen();
  }, [isSuccess]);

  return (
    <>
      <Tooltip title="Delete patient">
        <GridActionsCellItem
          onClick={toggleOpen}
          icon={<DeleteForeverIcon />}
          label="Delete"
          style={{ color: theme.palette.error.main }}
        />
      </Tooltip>
      <DialogAreYouSure
        open={open}
        onDisagree={toggleOpen}
        onAgree={handleOnDeleteProfile}
      />
    </>
  );
};
