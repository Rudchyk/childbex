import { CircularProgress, Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { usePatients, useToggle } from '../../../hooks';
import { usePatients as usePatients1 } from '../../../store/slices';
import { useNotifications } from '../../../modules/notifications';
import { SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { AddPatientForm } from './AddPatientForm';
import { DialogForm } from '../../../components';
import { useEffect, useState } from 'react';
import { AddPatientFormData } from './addPatientForm.schema';

export const AddPatient = () => {
  const title = 'Add patient';
  const [patientName, setPatientName] = useState('');
  const {
    addPatient,
    isLoading,
    isAddPatientError,
    addPatientError,
    isAddPatientSuccess,
    addedPatient,
    uploadPatientAssets,
    isUploadPatientAssetsError,
    isUploadPatientAssetsSuccess,
    uploadPatientAssetsError,
    isUploadPatientAssetsLoading,
  } = usePatients();
  const [archive, setArchive] = useState<File | undefined>();
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const { setIsLoading } = usePatients1();
  const onSubmit: SubmitHandler<AddPatientFormData> = async ({
    archive,
    ...other
  }) => {
    setPatientName(other.name);
    setArchive(archive);
    addPatient(other);
    toggleOpen();
  };
  const onError: SubmitErrorHandler<AddPatientFormData> = async (err) => {
    console.error(err);
  };

  useEffect(() => {
    setIsLoading(isUploadPatientAssetsLoading);
  }, [isUploadPatientAssetsLoading]);

  useEffect(() => {
    if (isAddPatientError) {
      notifyError(addPatientError);
    }
  }, [isAddPatientError]);

  useEffect(() => {
    if (isAddPatientSuccess && addedPatient) {
      notifySuccess(`Patient ${addedPatient.name} was added successfully!`);
      if (archive) {
        const formData = new FormData();
        formData.append('archive', archive);
        uploadPatientAssets({ id: addedPatient.id, body: formData });
      }
    }
  }, [isAddPatientSuccess]);

  useEffect(() => {
    if (isUploadPatientAssetsError) {
      notifyError(uploadPatientAssetsError);
    }
  }, [isUploadPatientAssetsError]);

  useEffect(() => {
    if (isUploadPatientAssetsSuccess) {
      notifySuccess(`Archive for ${patientName} was added successfully!`);
    }
  }, [isUploadPatientAssetsSuccess]);

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
        onDialogClose={toggleOpen}
        form={
          <AddPatientForm
            onSubmit={onSubmit}
            onError={onError}
            loading={isLoading}
          />
        }
      />
    </>
  );
};
