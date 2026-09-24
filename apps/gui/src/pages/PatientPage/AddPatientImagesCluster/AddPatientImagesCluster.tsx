import { Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from '../../../hooks';
import { useNotifications } from '../../../modules/notifications';
import {
  ArchiveUploadProgress,
  useArchiveUpload,
} from '../../../modules/archiveUpload';
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
  const { state, isActive, start, retry, cancel, reset } = useArchiveUpload();
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const onSubmit: SubmitHandler<AddPatientImagesClusterFormData> = async ({
    archive,
  }) => {
    // The dialog stays open to show progress; it closes on success.
    start(id, archive);
  };
  const onError: SubmitErrorHandler<AddPatientImagesClusterFormData> = async (
    err
  ) => {
    console.error(err);
  };
  const onDialogClose = () => {
    if (isActive) return;
    reset();
    toggleOpen();
  };

  useEffect(() => {
    if (state.phase === 'failed') {
      notifyError(state.error);
    }
    if (state.phase === 'completed') {
      notifySuccess(`Asset was uploaded successfully!`);
      reset();
      toggleOpen();
    }
  }, [state.phase]);

  return (
    <>
      <Tooltip title={title}>
        <Fab onClick={toggleOpen} color="secondary">
          <AddIcon fontSize="medium" />
        </Fab>
      </Tooltip>
      <DialogForm
        isLoading={isActive}
        title={title}
        open={open}
        isButtonCancel={!isActive}
        isButtonClose={!isActive}
        onDialogClose={onDialogClose}
        form={
          <AddPatientImagesClusterForm
            onSubmit={onSubmit}
            onError={onError}
            loading={isActive}
          />
        }
      >
        <ArchiveUploadProgress
          state={state}
          onRetry={retry}
          onCancel={cancel}
        />
      </DialogForm>
    </>
  );
};
