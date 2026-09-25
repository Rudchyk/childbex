import { Alert, Button, CircularProgress, Fab, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import type { UploadSession } from '@libs/schemas';
import { useToggle } from '../../../hooks';
import { usePatients } from '../../../store/slices';
import { useNotifications } from '../../../modules/notifications';
import {
  ArchiveUploadProgress,
  PendingUploadsList,
  useArchiveUpload,
  usePendingUploads,
} from '../../../modules/archiveUpload';
import { SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { AddPatientForm } from './AddPatientForm';
import { DialogForm } from '../../../components';
import { useEffect, useState } from 'react';
import { AddPatientFormData } from './addPatientForm.schema';
import { useAddPatientMutation, useGetPatientQuery } from '../../../store/apis';

type PatientValues = Omit<AddPatientFormData, 'archive'>;

/** An unfinished upload of the selected file, found before creating a patient. */
interface ResumeCandidate {
  session: UploadSession;
  archive: File;
  values: PatientValues;
}

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
  const pending = usePendingUploads();
  const [candidate, setCandidate] = useState<ResumeCandidate>();
  const { data: candidatePatient } = useGetPatientQuery(
    { id: candidate?.session.patientId ?? '' },
    { skip: !candidate }
  );
  const [isChecking, setIsChecking] = useState(false);
  const isLoading = isAddPatientLoading || upload.isActive || isChecking;
  // Once the patient exists (created here or resumed), "Send" must not
  // create another one; a failed upload is retried from the progress panel.
  const isPatientCreated =
    (isAddPatientSuccess && !!addedPatient) || upload.state.phase !== 'idle';
  const [archive, setArchive] = useState<File | undefined>();
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const { setIsLoading } = usePatients();

  const close = () => {
    upload.reset();
    resetAddPatient();
    setArchive(undefined);
    setCandidate(undefined);
    toggleOpen();
  };
  const createPatient = (values: PatientValues, file?: File) => {
    setPatientName(values.name);
    setArchive(file);
    addPatient(values);
  };
  const onSubmit: SubmitHandler<AddPatientFormData> = async ({
    archive,
    ...other
  }) => {
    if (isPatientCreated || candidate) return;
    if (archive) {
      // Never create a second patient for an upload that already started
      // (e.g. before a page reload): offer to resume it instead.
      setIsChecking(true);
      try {
        const session = await pending.findForFile(archive);
        if (session) {
          setCandidate({ session, archive, values: other });
          return;
        }
      } catch (error) {
        notifyError(error);
        return;
      } finally {
        setIsChecking(false);
      }
    }
    createPatient(other, archive);
  };
  const resumeCandidate = () => {
    if (!candidate) return;
    setPatientName(candidatePatient?.name ?? '');
    upload.start(
      candidate.session.patientId,
      candidate.archive,
      candidate.session
    );
    setCandidate(undefined);
  };
  const discardCandidate = async () => {
    if (!candidate) return;
    try {
      await pending.discard(candidate.session);
    } catch (error) {
      notifyError(error);
      return;
    }
    setCandidate(undefined);
    createPatient(candidate.values, candidate.archive);
  };
  const discardPending = async (session: UploadSession) => {
    try {
      await pending.discard(session);
    } catch (error) {
      notifyError(error);
    }
  };
  const onError: SubmitErrorHandler<AddPatientFormData> = async (err) => {
    console.error(err);
  };
  const onDialogClose = () => {
    if (isLoading) return;
    close();
  };

  useEffect(() => {
    if (open) pending.refresh();
  }, [open]);

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
      notifySuccess(
        patientName
          ? `Archive for ${patientName} was added successfully!`
          : 'Archive was added successfully!'
      );
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
          buttonProps: { disabled: isPatientCreated || !!candidate },
        }}
        form={
          <AddPatientForm
            onSubmit={onSubmit}
            onError={onError}
            loading={isLoading || isPatientCreated || !!candidate}
          />
        }
      >
        {candidate && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={
              <>
                <Button color="inherit" size="small" onClick={resumeCandidate}>
                  Resume
                </Button>
                <Button color="inherit" size="small" onClick={discardCandidate}>
                  Discard
                </Button>
              </>
            }
          >
            An unfinished upload of this archive exists for patient{' '}
            {candidatePatient?.name ?? '…'} (
            {candidate.session.receivedChunks.length} of{' '}
            {candidate.session.totalChunks} parts uploaded). Resume it, or
            discard it and create a new patient.
          </Alert>
        )}
        {upload.state.phase === 'idle' && !candidate && (
          <PendingUploadsList
            sessions={pending.sessions}
            error={pending.error}
            onDiscard={discardPending}
          />
        )}
        <ArchiveUploadProgress
          state={upload.state}
          onRetry={upload.retry}
          onCancel={upload.cancel}
        />
      </DialogForm>
    </>
  );
};
