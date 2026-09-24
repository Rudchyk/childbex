import { FC } from 'react';
import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import type { ArchiveUploadState } from './useArchiveUpload';

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

interface ArchiveUploadProgressProps {
  state: ArchiveUploadState;
  onRetry?: () => void;
  onCancel?: () => void;
}

export const ArchiveUploadProgress: FC<ArchiveUploadProgressProps> = ({
  state,
  onRetry,
  onCancel,
}) => {
  const { phase, percent, uploadedBytes, totalBytes } = state;
  if (phase === 'idle') return null;

  if (phase === 'failed') {
    return (
      <Alert
        severity="error"
        sx={{ mb: 2 }}
        action={
          <>
            {state.retryable && onRetry && (
              <Button color="inherit" size="small" onClick={onRetry}>
                Retry
              </Button>
            )}
            {onCancel && (
              <Button color="inherit" size="small" onClick={onCancel}>
                Discard
              </Button>
            )}
          </>
        }
      >
        {state.error}
        {state.retryable && ' Already uploaded parts are kept.'}
      </Alert>
    );
  }

  if (phase === 'cancelled') {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Upload cancelled.
      </Alert>
    );
  }

  if (phase === 'completed') {
    return (
      <Alert severity="success" sx={{ mb: 2 }}>
        Archive uploaded and imported.
      </Alert>
    );
  }

  const label =
    phase === 'uploading'
      ? `Uploading… ${percent}% (${formatBytes(uploadedBytes)} of ${formatBytes(
          totalBytes
        )})`
      : phase === 'processing'
      ? 'Processing the archive on the server… This can take a few minutes.'
      : 'Preparing upload…';

  return (
    <Box sx={{ mb: 2 }} role="status" aria-live="polite">
      <Typography variant="body2" sx={{ mb: 1 }}>
        {label}
      </Typography>
      <LinearProgress
        variant={phase === 'uploading' ? 'determinate' : 'indeterminate'}
        value={percent}
        aria-label="Upload progress"
      />
      {phase === 'uploading' && onCancel && (
        <Box sx={{ mt: 1, textAlign: 'right' }}>
          <Button size="small" onClick={onCancel}>
            Cancel upload
          </Button>
        </Box>
      )}
    </Box>
  );
};
