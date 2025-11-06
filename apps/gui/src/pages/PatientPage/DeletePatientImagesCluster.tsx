import { FC, useEffect } from 'react';
import { IconButton, Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '../../components';
import { GridActionsCellItem } from '@mui/x-data-grid';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { useNotifications } from '../../modules/notifications';
import { useToggle } from '../../hooks';
import { useDeletePatientImagesClusterMutation } from '../../store/apis';

interface DeletePatientImagesClusterProps {
  id: string;
}

export const DeletePatientImagesCluster: FC<
  DeletePatientImagesClusterProps
> = ({ id }) => {
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const [deletePatientImagesCluster, { isSuccess, isError, error }] =
    useDeletePatientImagesClusterMutation();
  const handleOnDeleteProfile = () => {
    deletePatientImagesCluster({ id });
  };
  useEffect(() => {
    if (isError) {
      notifyError(error);
    }
    toggleOpen();
  }, [isError]);

  useEffect(() => {
    if (isSuccess) {
      notifySuccess(`Patient images cluster was deleted successfully!`);
    }
    toggleOpen();
  }, [isSuccess]);

  return (
    <>
      <Tooltip title="Delete patient images cluster">
        <IconButton onClick={() => toggleOpen()} color="error">
          <DeleteForeverIcon />
        </IconButton>
      </Tooltip>
      <DialogAreYouSure
        open={open}
        onDisagree={toggleOpen}
        onAgree={handleOnDeleteProfile}
      />
    </>
  );
};
