import { CircularProgress, Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from '../../../hooks';
import { usePatients } from '../../../store/slices';
import { useNotifications } from '../../../modules/notifications';
import {
  ArchiveUploadProgress,
  useArchiveUpload,
} from '../../../modules/archiveUpload';
import { SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { AddPatientForm } from './AddPatientForm';
import { DialogForm } from '../../../components';
import { useEffect, useState } from 'react';
import { AddPatientFormData } from './addPatientForm.schema';
import { useAddPatientMutation } from '../../../store/apis';

export const AddPatient = () => {
  const title = 'Add patient';
  const [patientName, setPatientName] = useState('');
  const [
    addPatient,
    {
      data: addedPatient,
      isError: isAddPatientError,
      isLoading: isAddPatientLoading,
      error: addPatientError,
      isSuccess: isAddPatientSuccess,
      reset: resetAddPatient,
    },
  ] = useAddPatientMutation();
  const upload = useArchiveUpload();
  const isLoading = isAddPatientLoading || upload.isActive;
  // Once the patient exists, "Send" must not create it again; a failed
  // upload is retried from the progress panel instead.
  const isPatientCreated = isAddPatientSuccess && !!addedPatient;
  const [archive, setArchive] = useState<File | undefined>();
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const { setIsLoading } = usePatients();

  const close = () => {
    upload.reset();
    resetAddPatient();
    setArchive(undefined);
    toggleOpen();
  };
  const onSubmit: SubmitHandler<AddPatientFormData> = async ({
    archive,
    ...other
  }) => {
    if (isPatientCreated) return;
    setPatientName(other.name);
    setArchive(archive);
    addPatient(other);
  };
  const onError: SubmitErrorHandler<AddPatientFormData> = async (err) => {
    console.error(err);
  };
  const onDialogClose = () => {
    if (isLoading) return;
    close();
  };

  useEffect(() => {
    setIsLoading(upload.isActive);
  }, [upload.isActive]);

  useEffect(() => {
    if (isAddPatientError) {
      notifyError(addPatientError);
    }
  }, [isAddPatientError]);

  useEffect(() => {
    if (isAddPatientSuccess && addedPatient) {
      notifySuccess(`Patient ${addedPatient.name} was added successfully!`);
      if (archive) {
        upload.start(addedPatient.id, archive);
      } else {
        close();
      }
    }
  }, [isAddPatientSuccess]);

  useEffect(() => {
    if (upload.state.phase === 'failed') {
      notifyError(upload.state.error);
    }
    if (upload.state.phase === 'completed') {
      notifySuccess(`Archive for ${patientName} was added successfully!`);
      close();
    }
  }, [upload.state.phase]);

  return (
    <>
      <Tooltip title={title}>
        <Fab disabled={isLoading} onClick={toggleOpen} color="secondary">
          {isLoading ? (
            <CircularProgress color="inherit" size={24} />
          ) : (
            <AddIcon fontSize="medium" />
          )}
        </Fab>
      </Tooltip>
      <DialogForm
        isLoading={isLoading}
        title={title}
        open={open}
        isButtonCancel={!isLoading}
        isButtonClose={!isLoading}
        onDialogClose={onDialogClose}
        slotProps={{
          buttonProps: { disabled: isPatientCreated },
        }}
        form={
          <AddPatientForm
            onSubmit={onSubmit}
            onError={onError}
            loading={isLoading || isPatientCreated}
          />
        }
      >
        <ArchiveUploadProgress
          state={upload.state}
          onRetry={upload.retry}
          onCancel={upload.cancel}
        />
      </DialogForm>
    </>
  );
};
