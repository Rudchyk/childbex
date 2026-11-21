import { ChangeEvent, DragEvent, FC, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { VisuallyHiddenInput } from '../VisuallyHiddenInput/VisuallyHiddenInput';
import {
  selectionFromDataTransfer,
  selectionFromFileList,
} from './localImport/localImport.sources';
import { useLocalDicomImport } from './localImport/useLocalDicomImport';
import {
  LocalImportResultView,
  openTargetKey,
  targetToOpenDirectly,
  type LocalOpenTarget,
} from './localImport/LocalImportResultView';
import { formatBytes } from './localImport/localImport.files';
import {
  defaultLocalImportLimits,
  type LocalImportLimits,
} from './localImport/localImport.types';

export interface DicomViewerDropboxProps {
  isShow: boolean;
  onLoadFiles: (files: File[]) => void;
  /** Overrides the browser-side import limits (tests). */
  limits?: Partial<LocalImportLimits>;
}

/** `<input webkitdirectory>`: Chrome, Edge, Firefox and Safari support it. */
const supportsFolderPicker = () =>
  typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input');

const setDirectoryInput = (input: HTMLInputElement | null) => {
  input?.setAttribute('webkitdirectory', '');
};

/**
 * Local DICOM import of the standalone viewer: files, folders (dropped or
 * chosen, read recursively) and ZIP archives, read in this browser only.
 * Images are grouped by Series; one Series at a time goes to the viewer.
 */
export const DicomViewerDropbox: FC<DicomViewerDropboxProps> = ({
  isShow,
  onLoadFiles,
  limits,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [openedKey, setOpenedKey] = useState<string>();
  const [canPickFolder] = useState(supportsFolderPicker);
  const { state, start, cancel, retry, reset } = useLocalDicomImport(limits);
  const isRunning = state.status === 'running';
  const effectiveLimits = { ...defaultLocalImportLimits, ...limits };

  /** One stack of one Series (or one picture or video) at a time. */
  const open = useCallback(
    (target: LocalOpenTarget) => {
      setOpenedKey(openTargetKey(target));
      onLoadFiles(
        target.kind === 'series'
          ? target.series.instances.map((instance) => instance.file)
          : [target.media.file]
      );
    },
    [onLoadFiles]
  );

  // A single complete stack with nothing worth reviewing opens right away,
  // once per import result (not again when `onLoadFiles` changes).
  const result = state.status === 'done' ? state.result : undefined;
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const target = result && targetToOpenDirectly(result);
    if (target) openRef.current(target);
  }, [result]);

  const onReset = useCallback(() => {
    setOpenedKey(undefined);
    reset();
  }, [reset]);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Lets the same files or folder be chosen again.
    event.target.value = '';
    if (files.length) {
      setOpenedKey(undefined);
      start(selectionFromFileList(files));
    }
  };

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault(); // !important
      if (!isDragging) {
        setIsDragging(true);
      }
    },
    [isDragging]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (isRunning) return;
      // Entries must be taken now: the DataTransfer is emptied afterwards.
      const selection = selectionFromDataTransfer(e.dataTransfer);
      if (selection.roots.length) {
        setOpenedKey(undefined);
        start(selection);
      }
    },
    [isRunning, start]
  );

  if (!isShow) {
    return null;
  }

  const pickers = (
    <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
      <Button component="label" variant="contained" startIcon={<UploadFileIcon />}>
        Choose files
        <VisuallyHiddenInput
          type="file"
          multiple
          onChange={onChange}
          data-testid="local-import-files-input"
        />
      </Button>
      {canPickFolder && (
        <Button component="label" variant="outlined" startIcon={<FolderOpenIcon />}>
          Choose folder
          <VisuallyHiddenInput
            type="file"
            ref={setDirectoryInput}
            onChange={onChange}
            data-testid="local-import-folder-input"
          />
        </Button>
      )}
    </Stack>
  );

  return (
    <Box
      data-testid="dicom-viewer-dropbox"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        // Above the (empty) viewer layers, which also take pointer events.
        position: 'relative',
        zIndex: 1,
        p: 2,
        height: '100%',
        overflow: 'auto',
        bgcolor: 'background.paper',
        border: '5px dashed',
        borderColor: isDragging ? 'primary.main' : '#e8eaf6',
        display: 'flex',
        alignItems: state.status === 'done' ? 'flex-start' : 'center',
        justifyContent: 'center',
        '&:hover': {
          borderColor: 'primary.main',
        },
      }}
    >
      {state.status === 'idle' && (
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Typography variant="h6">Open DICOM images</Typography>
          <Typography>Drag and drop files, folders or a ZIP archive here, or</Typography>
          {pickers}
          {!canPickFolder && (
            <Typography variant="body2" color="text.secondary">
              This browser cannot choose folders: drag the folder here or choose a ZIP archive.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 520 }}>
            Files are opened in this browser only: nothing is uploaded or saved. Folders are
            searched recursively; files are recognised by their content (no .dcm extension
            needed). Up to {effectiveLimits.maxFiles.toLocaleString('en-US')} files, ZIP archives
            up to {formatBytes(effectiveLimits.maxArchiveBytes)} (not encrypted, no archives
            inside archives).
          </Typography>
        </Stack>
      )}

      {state.status === 'running' && (
        <Stack spacing={2} sx={{ width: '100%', maxWidth: 520 }} role="status" aria-live="polite">
          <Typography>
            {state.progress.archive
              ? `Extracting ${state.progress.archive.path}… ${state.progress.archive.percent}%`
              : 'Reading files…'}
          </Typography>
          {state.progress.archive ? (
            <LinearProgress variant="determinate" value={state.progress.archive.percent} />
          ) : (
            <LinearProgress />
          )}
          <Typography variant="body2" color="text.secondary">
            {state.progress.filesFound.toLocaleString('en-US')} files found ·{' '}
            {state.progress.instancesFound.toLocaleString('en-US')} DICOM images ·{' '}
            {state.progress.skippedCount.toLocaleString('en-US')} skipped
          </Typography>
          <Box>
            <Button variant="outlined" onClick={cancel}>
              Cancel
            </Button>
          </Box>
        </Stack>
      )}

      {(state.status === 'failed' || state.status === 'cancelled') && (
        <Stack spacing={2} sx={{ width: '100%', maxWidth: 520 }}>
          <Alert
            severity={state.status === 'failed' ? 'error' : 'info'}
            action={
              <>
                <Button color="inherit" size="small" onClick={retry}>
                  Retry
                </Button>
                <Button color="inherit" size="small" onClick={onReset}>
                  Start over
                </Button>
              </>
            }
          >
            {state.status === 'failed' ? state.message : 'Import cancelled.'}
          </Alert>
        </Stack>
      )}

      {state.status === 'done' && (
        <LocalImportResultView
          result={state.result}
          openedKey={openedKey}
          onOpen={open}
          onReset={onReset}
        />
      )}
    </Box>
  );
};
