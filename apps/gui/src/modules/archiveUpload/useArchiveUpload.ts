import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UploadSession } from '@libs/schemas';
import { apiBaseUrl, apiStore, TagTypesEnum } from '../../store/apis';
import { useAppDispatch } from '../../store/useAppStore';
import { getErrorMessage } from '../../utils';
import {
  archiveExtensionOf,
  findResumableSession,
  isAbortError,
  resumeHintKey,
  uploadArchive,
  UploadRequestError,
  type UploadPhase,
} from './chunkedUpload';
import {
  computeFileFingerprint,
  createHttpUploadTransport,
  localResumeStore,
  sha256Hex,
} from './httpTransport';

export interface ArchiveUploadState {
  phase: 'idle' | UploadPhase | 'failed' | 'cancelled';
  percent: number;
  uploadedBytes: number;
  totalBytes: number;
  error?: string;
  /** Whether "Retry" can continue the upload (already uploaded chunks are kept). */
  retryable?: boolean;
  session?: UploadSession;
}

const initialState: ArchiveUploadState = {
  phase: 'idle',
  percent: 0,
  uploadedBytes: 0,
  totalBytes: 0,
};

const ACTIVE_PHASES: ArchiveUploadState['phase'][] = [
  'preparing',
  'uploading',
  'processing',
];

/**
 * Chunked, resumable upload of a study archive for a patient, with progress.
 * Retrying (or re-selecting the same file after a reload) continues from the
 * chunks already stored on the server.
 */
export const useArchiveUpload = () => {
  const dispatch = useAppDispatch();
  const transport = useMemo(
    () => createHttpUploadTransport({ baseUrl: apiBaseUrl }),
    []
  );
  const [state, setState] = useState<ArchiveUploadState>(initialState);
  const controllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<UploadSession | null>(null);
  const lastRequestRef = useRef<{
    patientId: string;
    file: File;
    fingerprint?: string;
  } | null>(null);
  const isActive = ACTIVE_PHASES.includes(state.phase);

  const run = useCallback(
    async (patientId: string, file: File, resumeSession?: UploadSession) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const request: { patientId: string; file: File; fingerprint?: string } = {
        patientId,
        file,
      };
      lastRequestRef.current = request;
      sessionRef.current = null;
      setState({ ...initialState, phase: 'preparing', totalBytes: file.size });
      try {
        request.fingerprint = await computeFileFingerprint(file);
        const session = await uploadArchive({
          file,
          patientId,
          fingerprint: request.fingerprint,
          session: resumeSession,
          transport,
          hashChunk: sha256Hex,
          resumeStore: localResumeStore,
          signal: controller.signal,
          onSession: (s) => (sessionRef.current = s),
          onProgress: (progress) =>
            setState((prev) => ({ ...prev, ...progress, error: undefined })),
        });
        setState((prev) => ({ ...prev, phase: 'completed', session }));
        dispatch(
          apiStore.util.invalidateTags([
            TagTypesEnum.PATIENTS,
            TagTypesEnum.PATIENT,
          ])
        );
        return session;
      } catch (error) {
        if (isAbortError(error)) {
          setState((prev) => ({ ...prev, phase: 'cancelled' }));
        } else {
          setState((prev) => ({
            ...prev,
            phase: 'failed',
            error: getErrorMessage(error) || 'The upload failed.',
            retryable:
              !(error instanceof UploadRequestError) || error.retryable,
          }));
        }
        return undefined;
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [dispatch, transport]
  );

  /**
   * Uploads `file` for a patient. An unfinished upload of the same file for
   * this patient is resumed automatically; `resumeSession` selects one
   * explicitly (e.g. found before a patient would have been created).
   */
  const start = useCallback(
    (patientId: string, file: File, resumeSession?: UploadSession) =>
      run(patientId, file, resumeSession),
    [run]
  );

  /** Resumes the last upload; only missing chunks are uploaded. */
  const retry = useCallback(() => {
    const last = lastRequestRef.current;
    return last ? run(last.patientId, last.file) : Promise.resolve(undefined);
  }, [run]);

  /** Stops the upload and deletes the server-side session. */
  const cancel = useCallback(async () => {
    controllerRef.current?.abort();
    const session = sessionRef.current;
    const last = lastRequestRef.current;
    if (last?.fingerprint) {
      localResumeStore.remove(resumeHintKey(last.fingerprint));
    }
    if (session) {
      await transport.cancel(session.uploadId).catch(() => undefined);
    }
    setState((prev) => ({ ...prev, phase: 'cancelled' }));
  }, [transport]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    lastRequestRef.current = null;
    sessionRef.current = null;
    setState(initialState);
  }, []);

  // Warn before leaving the page while an upload is running.
  useEffect(() => {
    if (!isActive) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isActive]);

  // Stop network activity when the component unmounts; the session stays
  // on the server and can be resumed later.
  useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, isActive, start, retry, cancel, reset };
};

/**
 * The caller's unfinished uploads (server-side list), e.g. to resume one after
 * a page reload or to discard an abandoned one.
 */
export const usePendingUploads = (patientId?: string) => {
  const transport = useMemo(
    () => createHttpUploadTransport({ baseUrl: apiBaseUrl }),
    []
  );
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const list = await transport.listSessions();
      setSessions(
        patientId ? list.filter((s) => s.patientId === patientId) : list
      );
      setError(undefined);
    } catch (e) {
      setError(getErrorMessage(e) || 'Unfinished uploads could not be loaded.');
    }
  }, [transport, patientId]);

  /** Cancels an unfinished upload and deletes its data on the server. */
  const discard = useCallback(
    async (session: UploadSession) => {
      await transport.cancel(session.uploadId);
      if (session.clientFingerprint) {
        localResumeStore.remove(resumeHintKey(session.clientFingerprint));
      }
      await refresh();
    },
    [transport, refresh]
  );

  /** The unfinished upload of this exact file, for any patient, if any. */
  const findForFile = useCallback(
    async (file: File) =>
      findResumableSession(await transport.listSessions(), {
        fingerprint: await computeFileFingerprint(file),
        fileSize: file.size,
        extension: archiveExtensionOf(file.name),
      }),
    [transport]
  );

  return { sessions, error, refresh, discard, findForFile };
};
