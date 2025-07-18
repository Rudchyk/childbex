'use client';

import { FormControlLabel, Stack, Switch } from '@mui/material';
import { FC, useActionState, useEffect, startTransition } from 'react';
import { UpdatePatientImageActionStates } from './UpdatePatientImageActionStates.enum';
import { PatientImage, PatientImageTypes } from '@/types';
import {
  updatePatientImage,
  UpdatePatientImageActionState,
  UpdatePatientImageData,
} from './updatePatientImage.actions';
import { useNotifications } from '@/lib/modules/NotificationsModule';
import { useRouter } from 'next/navigation';

interface PatientDWVToolbarProps {
  item?: PatientImage;
}

export const PatientDWVToolbar: FC<PatientDWVToolbarProps> = ({ item }) => {
  const router = useRouter();
  const [state, formAction] = useActionState<
    UpdatePatientImageActionState,
    UpdatePatientImageData
  >(updatePatientImage, {
    status: UpdatePatientImageActionStates.IDLE,
  });
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const handleChange = () => {
    if (item) {
      startTransition(() => {
        formAction({
          id: item.id,
          type:
            item.type === PatientImageTypes.ANOMALY
              ? PatientImageTypes.NORMAL
              : PatientImageTypes.ANOMALY,
        });
      });
    }
  };
  useEffect(() => {
    switch (state.status) {
      case UpdatePatientImageActionStates.PATIENT_IMAGE_DOES_NOT_EXISTS:
        notifyWarning('Patient image does not exist!');
        break;
      case UpdatePatientImageActionStates.FAILED:
        notifyError(`Failed to create patient! ${state.message}`);
        break;
      case UpdatePatientImageActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case UpdatePatientImageActionStates.SUCCESS:
        notifySuccess('Patient image is updated successfully!');
        window.location.reload();
        break;
      default:
        break;
    }
  }, [state]);

  return (
    <Stack direction="row" justifyContent="center">
      <FormControlLabel
        control={
          <Switch onChange={handleChange} checked={item?.type === 'anomaly'} />
        }
        label="Anomaly"
      />
    </Stack>
  );
};
