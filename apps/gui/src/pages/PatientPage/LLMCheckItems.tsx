import {
  useLlmServiceCheckItemsMutation,
  useLlmServiceHealthMutation,
} from '../../store/apis';
import { UIDialog } from '../../components';
import {
  Avatar,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useToggle } from '../../hooks';
import { FC, useEffect } from 'react';
import { useNotifications } from '../../modules/notifications';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import { format } from 'date-fns';
import ThumbUpAltIcon from '@mui/icons-material/ThumbUpAlt';
import HeartBrokenIcon from '@mui/icons-material/HeartBroken';
import { green, red } from '@mui/material/colors';
import TodayIcon from '@mui/icons-material/Today';
import { PatientImage } from '@libs/schemas';
import BiotechIcon from '@mui/icons-material/Biotech';
import AcUnitIcon from '@mui/icons-material/AcUnit';

interface LLMCheckItemsProps {
  items: string[];
  disabled?: boolean;
}

export const LLMCheckItems: FC<LLMCheckItemsProps> = ({ items, disabled }) => {
  const [open, toggleOpen] = useToggle(false);
  const [llmServiceCheckItems, { data, isError, isLoading, isSuccess, error }] =
    useLlmServiceCheckItemsMutation();
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
        disabled={disabled || isLoading || items.length === 0}
        variant="contained"
        color="primary"
        startIcon={<BiotechIcon />}
        onClick={() => llmServiceCheckItems(items)}
        loading={isLoading}
      >
        Check
      </Button>
      <UIDialog
        slotProps={{ dialogProps: { maxWidth: 'lg' } }}
        isButtonCancel={false}
        isButtonPrimary={false}
        open={open}
        onDialogClose={toggleOpen}
        title="Abnormal Items"
      >
        <List>
          {data?.items.map((item, index) => (
            <ListItem key={item + index}>
              <ListItemAvatar>
                <Avatar>
                  <AcUnitIcon />
                </Avatar>
              </ListItemAvatar>
              <ListItemText primary={item.split('/').pop()} />
            </ListItem>
          ))}
        </List>
      </UIDialog>
    </>
  );
};
