import { FC, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material';
import type { UploadSession } from '@libs/schemas';
import { useGetPatientQuery } from '../../store/apis';

const statusText = (session: UploadSession) => {
  if (session.status === 'assembling' || session.status === 'processing') {
    return 'being processed on the server';
  }
  if (session.status === 'failed') return 'failed, can be retried';
  return `${session.receivedChunks.length} of ${session.totalChunks} parts uploaded`;
};

const PendingUploadItem: FC<{
  session: UploadSession;
  showPatient: boolean;
  onDiscard: (session: UploadSession) => Promise<void>;
}> = ({ session, showPatient, onDiscard }) => {
  const { data: patient } = useGetPatientQuery(
    { id: session.patientId },
    { skip: !showPatient }
  );
  const [busy, setBusy] = useState(false);
  const processing =
    session.status === 'assembling' || session.status === 'processing';
  return (
    <ListItem
      disableGutters
      secondaryAction={
        <Button
          size="small"
          disabled={busy || processing}
          onClick={async () => {
            setBusy(true);
            try {
              await onDiscard(session);
            } finally {
              setBusy(false);
            }
          }}
        >
          Discard
        </Button>
      }
    >
      <ListItemText
        primary={showPatient ? patient?.name ?? 'Patient' : 'Archive upload'}
        secondary={statusText(session)}
      />
    </ListItem>
  );
};

interface PendingUploadsListProps {
  sessions: UploadSession[];
  onDiscard: (session: UploadSession) => Promise<void>;
  /** Show the patient of each upload (not needed on a patient's own page). */
  showPatient?: boolean;
  error?: string;
}

/** Unfinished uploads of the user, with a way to discard abandoned ones. */
export const PendingUploadsList: FC<PendingUploadsListProps> = ({
  sessions,
  onDiscard,
  showPatient = true,
  error,
}) => {
  if (error) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        {error}
      </Alert>
    );
  }
  if (!sessions.length) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">Unfinished uploads</Typography>
      <Typography variant="body2" color="text.secondary">
        To resume, select the same archive file again.
      </Typography>
      <List dense>
        {sessions.map((session) => (
          <PendingUploadItem
            key={session.uploadId}
            session={session}
            showPatient={showPatient}
            onDiscard={onDiscard}
          />
        ))}
      </List>
    </Box>
  );
};
