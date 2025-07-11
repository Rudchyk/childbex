import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '@/lib/components';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { TrashedUsersActionStates } from './TrashedUsersActionStates.enum';
import {
  TrashedUsersActionState,
  trashedUsers,
  TrashedUsersData,
} from './trashedUsers.action';
import { useToggle } from 'usehooks-ts';
import { useRouter } from 'next/navigation';
import { GridActionsCellItem } from '@mui/x-data-grid';
import RestoreIcon from '@mui/icons-material/Restore';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { TrashedUsersActionTypes } from './TrashedUsersActionTypes.enum';
import { startCase } from 'lodash';

interface TrashActionProps {
  id: string;
  type: TrashedUsersActionTypes;
}

export const TrashAction: FC<TrashActionProps> = ({ id, type }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const router = useRouter();
  const [state, formAction] = useActionState<
    TrashedUsersActionState,
    TrashedUsersData
  >(trashedUsers, {
    status: TrashedUsersActionStates.IDLE,
  });
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction({ id, type });
    });
  };
  const getIcon = () => {
    switch (type) {
      case TrashedUsersActionTypes.RESTORE:
        return <RestoreIcon />;
      case TrashedUsersActionTypes.DELETE:
        return <DeleteForeverIcon />;
      default:
        return <></>;
    }
  };
  useEffect(() => {
    if (state.status === TrashedUsersActionStates.USER_DO_NOT_EXIST) {
      notifyWarning('User do not exist!');
    } else if (state.status === TrashedUsersActionStates.FAILED) {
      notifyError(`Failed to ${type} user!`);
    } else if (state.status === TrashedUsersActionStates.SUCCESS) {
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
                type === TrashedUsersActionTypes.DELETE ? 'error' : 'primary'
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
