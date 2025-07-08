import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '@/lib/components';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { TrashActionStates } from './TrashActionStates.enum';
import { TrashActionState, trash, TrashData } from './trash.action';
import { useToggle } from 'usehooks-ts';
import { useRouter } from 'next/navigation';
import { GridActionsCellItem } from '@mui/x-data-grid';
import RestoreIcon from '@mui/icons-material/Restore';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { TrashActionTypes } from './TrashActionTypes.enum';
import { startCase } from 'lodash';

interface TrashActionProps {
  id: string;
  type: TrashActionTypes;
}

export const TrashAction: FC<TrashActionProps> = ({ id, type }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const router = useRouter();
  const [state, formAction] = useActionState<TrashActionState, TrashData>(
    trash,
    {
      status: TrashActionStates.IDLE,
    }
  );
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction({ id, type });
    });
  };
  const getIcon = () => {
    switch (type) {
      case TrashActionTypes.RESTORE:
        return <RestoreIcon />;
      case TrashActionTypes.DELETE:
        return <DeleteForeverIcon />;
      default:
        return <></>;
    }
  };
  useEffect(() => {
    if (state.status === TrashActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('User do not exist!');
    } else if (state.status === TrashActionStates.FAILED) {
      notifyError(`Failed to ${type} user!`);
    } else if (state.status === TrashActionStates.SUCCESS) {
      notifySuccess(`User was ${type}d successfully!`);
      router.refresh();
    }
    toggleOpen();
  }, [state]);

  return (
    <>
      <Tooltip title={`${startCase(type)} account`}>
        <GridActionsCellItem
          onClick={toggleOpen}
          icon={getIcon()}
          label={startCase(type)}
          style={{
            color:
              theme.palette[
                type === TrashActionTypes.DELETE ? 'error' : 'primary'
              ].main,
          }}
        />
      </Tooltip>
      <DialogAreYouSure
        open={open}
        onDisagree={toggleOpen}
        onAgree={handleOnDeleteProfile}
      />
    </>
  );
};
