import { FC, useEffect } from 'react';
import { Tooltip, useTheme } from '@mui/material';
import { GridActionsCellItem } from '@mui/x-data-grid';
import RestoreIcon from '@mui/icons-material/Restore';
import { startCase } from 'lodash';
import { useNotifications } from '../../modules/notifications';
import { useToggle } from '../../hooks';
import { TrashedPatientsActionTypes } from '@libs/constants';
import { useDeleteOrRestoreTrashedPatientMutation } from '../../store/apis';
import { DialogAreYouSure } from '../../components';

import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';

interface TrashedPatientsActionProps {
  id: string;
  type: TrashedPatientsActionTypes;
}

export const TrashedPatientsAction: FC<TrashedPatientsActionProps> = ({
  id,
  type,
}) => {
  const { notifyError, notifySuccess } = useNotifications();
  const [open, toggleOpen] = useToggle(false);
  const theme = useTheme();
  const [
    deleteOrRestoreTrashedPatient,
    { data, isError, error, isSuccess, originalArgs },
  ] = useDeleteOrRestoreTrashedPatientMutation();
  const handleOnDeleteProfile = () => {
    deleteOrRestoreTrashedPatient({
      id,
      type,
    });
    toggleOpen();
  };
  const getIcon = () => {
    switch (type) {
      case TrashedPatientsActionTypes.RESTORE:
        return <RestoreIcon color="success" />;
      case TrashedPatientsActionTypes.DELETE:
        return <DeleteSweepIcon />;
      default:
        return <></>;
    }
  };
  useEffect(() => {
    if (isError) {
      notifyError(error);
    }
  }, [isError]);

  useEffect(() => {
    if (isSuccess) {
      notifySuccess(
        `Patient ${data?.name} was ${originalArgs?.type}d successfully!`
      );
    }
  }, [isSuccess]);

  return (
    <>
      <Tooltip title={`${startCase(type)} patient`}>
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
