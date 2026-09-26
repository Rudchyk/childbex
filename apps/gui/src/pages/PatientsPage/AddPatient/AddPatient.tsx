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
import { createdPatientHints } from '../../../modules/archiveUpload/httpTransport';
import { SubmitHandler, SubmitErrorHandler } from 'react-hook-form';
import { AddPatientForm } from './AddPatientForm';
import { DialogForm } from '../../../components';
import { useEffect, useRef, useState } from 'react';
import { AddPatientFormData } from './addPatientForm.schema';
import { useAddPatientMutation, useGetPatientQuery } from '../../../store/apis';

type PatientValues = Omit<AddPatientFormData, 'archive'>;

/**
 * Something already exists for the selected archive; the user must choose
 * before anything else happens (no patient is created meanwhile).
 */
type Candidate =
  | {
      kind: 'session';
      session: UploadSession;
      archive: File;
      fingerprint: string;
    }
  | { kind: 'patient'; patientId: string; archive: File; fingerprint: string };

/**
 * Invariants:
 * - one explicit Send -> at most one addPatient();
 * - an existing unfinished upload (or a patient already created for the
 *   archive) -> no addPatient() until the user explicitly sends again;
 * - Discard never creates a patient.
 */
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
  const [candidate, setCandidate] = useState<Candidate>();
  const candidatePatientId =
    candidate?.kind === 'session'
      ? candidate.session.patientId
      : candidate?.patientId;
  const { data: candidatePatient } = useGetPatientQuery(
    { id: candidatePatientId ?? '' },
    { skip: !candidatePatientId }
  );
  const [isChecking, setIsChecking] = useState(false);
  // Synchronous guards: React state updates are too late to stop a second
  // submit fired before the next render (e.g. a double click).
  const submittingRef = useRef(false);
  const patientCreatedRef = useRef(false);
  const fingerprintRef = useRef<string | undefined>(undefined);
  const isLoading = isAddPatientLoading || upload.isActive || isChecking;
  // Once a patient exists for this dialog (created or resumed), "Send" must
  // not create another one; a failed upload is retried from the panel.
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
    submittingRef.current = false;
    patientCreatedRef.current = false;
    fingerprintRef.current = undefined;
    toggleOpen();
  };
  const onSubmit: SubmitHandler<AddPatientFormData> = async ({
    archive,
    ...other
  }) => {
    if (submittingRef.current || patientCreatedRef.current || candidate) {
      return;
    }
    submittingRef.current = true;
    let creating = false;
    try {
      fingerprintRef.current = undefined;
      if (archive) {
        setIsChecking(true);
        const found = await pending.lookup(archive);
        fingerprintRef.current = found.fingerprint;
        if (found.session) {
          setCandidate({
            kind: 'session',
            session: found.session,
            archive,
            fingerprint: found.fingerprint,
          });
          return;
        }
        if (found.createdPatientId) {
          setCandidate({
            kind: 'patient',
            patientId: found.createdPatientId,
            archive,
            fingerprint: found.fingerprint,
          });
          return;
        }
      }
      creating = true;
      patientCreatedRef.current = true;
      setPatientName(other.name);
      setArchive(archive);
      addPatient(other as PatientValues);
    } catch (error) {
      notifyError(error);
    } finally {
      setIsChecking(false);
      // Stays set once a patient is being created (reset on close/error).
      if (!creating) submittingRef.current = false;
    }
  };
  /** Continues the existing upload / uploads to the existing patient. */
  const continueCandidate = () => {
    if (!candidate) return;
    patientCreatedRef.current = true;
    setPatientName(candidatePatient?.name ?? '');
    if (candidate.kind === 'session') {
      upload.start(
        candidate.session.patientId,
        candidate.archive,
        candidate.session
      );
    } else {
      upload.start(candidate.patientId, candidate.archive);
    }
    setCandidate(undefined);
  };
  /**
   * Discards the existing upload (or forgets the created patient for this
   * archive). Does not create anything: the form stays open and the user
   * may press Send again.
   */
  const discardCandidate = async () => {
    if (!candidate) return;
    try {
      if (candidate.kind === 'session') {
        await pending.discard(candidate.session);
      }
      createdPatientHints.remove(candidate.fingerprint);
    } catch (error) {
      notifyError(error);
      return;
    }
    setCandidate(undefined);
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
      // Nothing was created: allow another explicit Send.
      submittingRef.current = false;
      patientCreatedRef.current = false;
      notifyError(addPatientError);
    }
  }, [isAddPatientError]);

  useEffect(() => {
    if (isAddPatientSuccess && addedPatient) {
      notifySuccess(`Patient ${addedPatient.name} was added successfully!`);
      if (archive) {
        // Link the new patient to this archive before its upload session
        // exists, so a later attempt uploads to it instead of creating a
        // second patient (e.g. after a reload or a failed start).
        if (fingerprintRef.current) {
          createdPatientHints.set(fingerprintRef.current, addedPatient.id);
        }
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
      if (fingerprintRef.current) {
        createdPatientHints.remove(fingerprintRef.current);
      }
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
                <Button
                  color="inherit"
                  size="small"
                  onClick={continueCandidate}
                >
                  {candidate.kind === 'session' ? 'Resume' : 'Upload'}
                </Button>
                <Button color="inherit" size="small" onClick={discardCandidate}>
                  Discard
                </Button>
              </>
            }
          >
            {candidate.kind === 'session' ? (
              <>
                An unfinished upload of this archive exists for patient{' '}
                {candidatePatient?.name ?? '…'} (
                {candidate.session.receivedChunks.length} of{' '}
                {candidate.session.totalChunks} parts uploaded). Resume it, or
                discard it.
              </>
            ) : (
              <>
                Patient {candidatePatient?.name ?? '…'} was already created for
                this archive, but its upload did not start. Upload the archive
                to this patient, or discard this suggestion.
              </>
            )}
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
