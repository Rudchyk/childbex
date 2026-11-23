import { useCallback, useEffect, useRef, useState } from 'react';
import { importLocalDicom } from './localImport.pipeline';
import type { InputSelection } from './localImport.sources';
import {
  LocalImportError,
  type LocalImportLimits,
  type LocalImportProgress,
  type LocalImportResult,
} from './localImport.types';

export type LocalImportState =
  | { status: 'idle' }
  | { status: 'running'; progress: LocalImportProgress }
  | { status: 'done'; result: LocalImportResult }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

/** Progress re-renders at most this often. */
const PROGRESS_INTERVAL_MS = 100;

const initialProgress: LocalImportProgress = {
  filesFound: 0,
  filesChecked: 0,
  instancesFound: 0,
  skippedCount: 0,
};

/**
 * Runs one local import at a time. A new import, cancel, reset and unmount
 * abort the running one; its late results are ignored. Reset (and unmount)
 * also drops the found files, so extracted data can be released.
 */
export const useLocalDicomImport = (limits?: Partial<LocalImportLimits>) => {
  const [state, setState] = useState<LocalImportState>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  /** The last selection (kept for Retry). */
  const selectionRef = useRef<InputSelection | null>(null);
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const abortRunning = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  };

  const start = useCallback((selection: InputSelection) => {
    abortRunning();
    selectionRef.current = selection;
    if (!selection.roots.length) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => controllerRef.current === controller;
    let lastProgressAt = 0;
    setState({ status: 'running', progress: initialProgress });

    importLocalDicom(selection, {
      limits: limitsRef.current,
      signal: controller.signal,
      onProgress: (progress) => {
        const now = Date.now();
        if (now - lastProgressAt < PROGRESS_INTERVAL_MS || !isCurrent()) return;
        lastProgressAt = now;
        setState({ status: 'running', progress });
      },
    }).then(
      (result) => {
        if (!isCurrent()) return;
        controllerRef.current = null;
        setState({ status: 'done', result });
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        controllerRef.current = null;
        if (error instanceof LocalImportError && error.code === 'CANCELLED') {
          setState({ status: 'cancelled' });
          return;
        }
        setState({
          status: 'failed',
          message:
            error instanceof LocalImportError
              ? error.message
              : 'The files could not be read. Try again or choose fewer files.',
        });
      }
    );
  }, []);

  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    abortRunning();
    setState({ status: 'cancelled' });
  }, []);

  const retry = useCallback(() => {
    if (selectionRef.current) start(selectionRef.current);
  }, [start]);

  const reset = useCallback(() => {
    abortRunning();
    selectionRef.current = null;
    setState({ status: 'idle' });
  }, []);

  useEffect(
    () => () => {
      abortRunning();
      selectionRef.current = null;
    },
    []
  );

  return { state, start, cancel, retry, reset };
};
