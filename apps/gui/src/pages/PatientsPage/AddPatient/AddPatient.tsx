import { Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useToggle } from '../../../hooks';
import {
  useAddPatientMutation,
  useUploadPatientAssetsMutation,
} from '../../../store/apis';
import { useNotifications } from '../../../modules/notifications';
import { SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { AddPatientForm } from './AddPatientForm';
import { DialogForm } from '../../../components';
import { useEffect, useState } from 'react';
import { AddPatientFormData } from './addPatientForm.schema';

export const AddPatient = () => {
  const title = 'Add patient';
  const [
    addPatient,
    { data, isError, isLoading: isAddPatientLoading, error, isSuccess },
  ] = useAddPatientMutation();
  const [patientName, setPatientName] = useState('');
  const [archive, setArchive] = useState<File | undefined>();
  const [uploadPatientAssets, uploadPatientAssetsState] =
    useUploadPatientAssetsMutation();
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const onSubmit: SubmitHandler<AddPatientFormData> = async ({
    archive,
    ...other
  }) => {
    setPatientName(other.name);
    setArchive(archive);
    addPatient(other);
  };
  const onError: SubmitErrorHandler<AddPatientFormData> = async (err) => {
    console.error(err);
  };
  const isLoading = isAddPatientLoading || uploadPatientAssetsState.isLoading;

  useEffect(() => {
    if (isError) {
      notifyError(error);
    }
    toggleOpen();
  }, [isError]);

  useEffect(() => {
    if (isSuccess && data) {
      notifySuccess(`Patient ${data.name} was added successfully!`);
      if (archive) {
        const formData = new FormData();
        formData.append('archive', archive);
        uploadPatientAssets({ id: data.id, body: formData });
      }
    }
    toggleOpen();
  }, [isSuccess]);

  useEffect(() => {
    if (uploadPatientAssetsState.isError) {
      notifyError(uploadPatientAssetsState.error);
    }
  }, [uploadPatientAssetsState.isError]);

  useEffect(() => {
    if (uploadPatientAssetsState.isSuccess) {
      notifySuccess(`Archive for ${patientName} was added successfully!`);
    }
  }, [uploadPatientAssetsState.isSuccess]);

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
