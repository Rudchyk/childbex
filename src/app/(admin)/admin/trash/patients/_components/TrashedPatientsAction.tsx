import { FC, startTransition, useActionState, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { DialogAreYouSure } from '@/lib/components';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { TrashedPatientsActionStates } from './TrashedPatientsActionStates.enum';
import {
  TrashedPatientsActionState,
  TrashedPatientsData,
  trashedPatients,
} from './trashedPatients.action';
import { useToggle } from 'usehooks-ts';
import { useRouter } from 'next/navigation';
import { GridActionsCellItem } from '@mui/x-data-grid';
import RestoreIcon from '@mui/icons-material/Restore';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import { TrashedPatientsActionTypes } from './TrashedPatientsActionTypes.enum';
import { startCase } from 'lodash';

interface TrashActionProps {
  id: string;
  type: TrashedPatientsActionTypes;
}

export const TrashAction: FC<TrashActionProps> = ({ id, type }) => {
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const router = useRouter();
  const [state, formAction] = useActionState<
    TrashedPatientsActionState,
    TrashedPatientsData
  >(trashedPatients, {
    status: TrashedPatientsActionStates.IDLE,
  });
  const handleOnDeleteProfile = () => {
    startTransition(() => {
      formAction({ id, type });
    });
  };
  const getIcon = () => {
    switch (type) {
      case TrashedPatientsActionTypes.RESTORE:
        return <RestoreIcon />;
      case TrashedPatientsActionTypes.DELETE:
        return <DeleteForeverIcon />;
      default:
        return <></>;
    }
  };
  useEffect(() => {
    if (state.status === TrashedPatientsActionStates.PATIENT_DO_NOT_EXIST) {
      notifyWarning('User do not exist!');
    } else if (state.status === TrashedPatientsActionStates.FAILED) {
      notifyError(`Failed to ${type} user!`);
    } else if (state.status === TrashedPatientsActionStates.SUCCESS) {
      notifySuccess(`User was ${type}d successfully!`);
      router.refresh();
    }
    if (state.status !== TrashedPatientsActionStates.IDLE) {
      toggleOpen();
    }
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
                type === TrashedPatientsActionTypes.DELETE ? 'error' : 'primary'
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
