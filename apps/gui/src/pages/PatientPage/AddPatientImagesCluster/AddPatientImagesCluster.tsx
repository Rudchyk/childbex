import { Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from '../../../hooks';
import { useNotifications } from '../../../modules/notifications';
import {
  ArchiveUploadProgress,
  PendingUploadsList,
  useArchiveUpload,
  usePendingUploads,
} from '../../../modules/archiveUpload';
import type { UploadSession } from '@libs/schemas';
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
  // Unfinished uploads for this patient; selecting the same file resumes.
  const pending = usePendingUploads(id);
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
  const discardPending = async (session: UploadSession) => {
    try {
      await pending.discard(session);
    } catch (error) {
      notifyError(error);
    }
  };
  const onDialogClose = () => {
    if (isActive) return;
    reset();
    toggleOpen();
  };

  useEffect(() => {
    if (open) pending.refresh();
  }, [open]);

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
        {state.phase === 'idle' && (
          <PendingUploadsList
            sessions={pending.sessions}
            error={pending.error}
            showPatient={false}
            onDiscard={discardPending}
          />
        )}
        <ArchiveUploadProgress
          state={state}
          onRetry={retry}
          onCancel={cancel}
        />
      </DialogForm>
    </>
  );
};
