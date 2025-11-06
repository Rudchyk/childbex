import { Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from '../../../hooks';
import { useUploadPatientAssetsMutation } from '../../../store/apis';
import { useNotifications } from '../../../modules/notifications';
import { SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { AddPatientImagesClusterForm } from './AddPatientImagesClusterForm';
import { DialogForm } from '../../../components';
import { FC, useEffect } from 'react';
import { AddPatientImagesClusterFormData } from './addPatientImagesClusterForm.schema';

interface AddPatientImagesClusterProps {
  id: string;
}

export const AddPatientImagesCluster: FC<AddPatientImagesClusterProps> = ({
  id,
}) => {
  const title = 'Add patient asset';
  const [uploadPatientAssets, { isLoading, isSuccess, error, isError }] =
    useUploadPatientAssetsMutation();
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const onSubmit: SubmitHandler<AddPatientImagesClusterFormData> = async ({
    archive,
  }) => {
    const formData = new FormData();
    formData.append('archive', archive);
    uploadPatientAssets({ id, body: formData });
  };
  const onError: SubmitErrorHandler<AddPatientImagesClusterFormData> = async (
    err
  ) => {
    console.error(err);
  };

  useEffect(() => {
    if (isError) {
      notifyError(error);
    }
    toggleOpen();
  }, [isError]);

  useEffect(() => {
    if (isSuccess) {
      notifySuccess(`Asset was uploaded successfully!`);
    }
    toggleOpen();
  }, [isSuccess]);

  return (
    <>
      <Tooltip title={title}>
        <Fab onClick={toggleOpen} color="secondary">
          <AddIcon fontSize="medium" />
        </Fab>
      </Tooltip>
      <DialogForm
        isLoading={isLoading}
        title={title}
        open={open}
        isButtonCancel={!isLoading}
        isButtonClose={!isLoading}
        onDialogClose={toggleOpen}
        form={
          <AddPatientImagesClusterForm
            onSubmit={onSubmit}
            onError={onError}
            loading={isLoading}
          />
        }
      />
    </>
  );
};
