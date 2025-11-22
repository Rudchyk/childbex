import { useLlmServiceHealthMutation } from '../../store/apis';
import { UIDialog } from '../../components';
import { Avatar, Button, Stack, Typography } from '@mui/material';
import { useToggle } from '../../hooks';
import { useEffect } from 'react';
import { useNotifications } from '../../modules/notifications';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import { format } from 'date-fns';
import ThumbUpAltIcon from '@mui/icons-material/ThumbUpAlt';
import HeartBrokenIcon from '@mui/icons-material/HeartBroken';
import { green, red } from '@mui/material/colors';
import TodayIcon from '@mui/icons-material/Today';

export const LLMHealth = () => {
  const [open, toggleOpen] = useToggle(false);
  const [llmServiceHealth, { data, isError, isLoading, isSuccess, error }] =
    useLlmServiceHealthMutation();
  const { notifyError } = useNotifications();

  useEffect(() => {
    if (isError && error) {
      notifyError(error);
    }
  }, [isError, error]);

  useEffect(() => {
    if (isSuccess && data) {
      toggleOpen();
    }
  }, [isSuccess, data]);

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        startIcon={<MonitorHeartIcon />}
        onClick={() => llmServiceHealth()}
        loading={isLoading}
      >
        Check LLM health
      </Button>
      <UIDialog
        slotProps={{ dialogProps: { maxWidth: 'lg' } }}
        isButtonCancel={false}
        isButtonPrimary={false}
        open={open}
        onDialogClose={toggleOpen}
        title="LLM Health"
      >
        <Stack width={300} spacing={2} alignItems="center" mb={2}>
          <Typography
            gutterBottom
            sx={{
              color: 'text.secondary',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <TodayIcon />
            {format(data?.timestamp || Date.now(), 'PPpp')}
          </Typography>
          <Avatar
            sx={{ bgcolor: data?.status === 'ok' ? green[500] : red[500] }}
          >
            {data?.status === 'ok' ? <ThumbUpAltIcon /> : <HeartBrokenIcon />}
          </Avatar>
        </Stack>
      </UIDialog>
    </>
  );
};
