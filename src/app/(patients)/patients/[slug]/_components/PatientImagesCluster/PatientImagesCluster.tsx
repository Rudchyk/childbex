'use client';

import { useNotifications } from '@/lib/modules/NotificationsModule';
import { FC, startTransition, useActionState, useEffect } from 'react';
import { UpdatePatientImageClusterActionStates } from './UpdatePatientImageClusterActionStates.enum';
import {
  updatePatientImageCluster,
  UpdatePatientImageClusterActionState,
  UpdatePatientImageClusterData,
} from './updatePatientImageCluster.action';
import { useRouter } from 'next/navigation';
import { PatientImageCluster } from '@/types';
import {
  Avatar,
  Chip,
  FormControlLabel,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Switch,
} from '@mui/material';
import NextLink from 'next/link';
import { paths } from '@/lib/constants/paths';
import ImageIcon from '@mui/icons-material/Image';
import { format } from 'date-fns';
import pluralize from 'pluralize';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';

interface PatientImagesClusterProps {
  item: PatientImageCluster;
  slug: string;
}

export const PatientImagesCluster: FC<PatientImagesClusterProps> = ({
  item,
  slug,
}) => {
  const router = useRouter();
  const isBrocken = item.cluster === -1;
  const { notifyError, notifySuccess, notifyWarning } = useNotifications();
  const [state, formAction] = useActionState<
    UpdatePatientImageClusterActionState,
    UpdatePatientImageClusterData
  >(updatePatientImageCluster, {
    status: UpdatePatientImageClusterActionStates.IDLE,
  });
  const handleToggle = (id: string, newValue: boolean) => () => {
    startTransition(() => {
      return formAction({ id, inReview: newValue });
    });
  };

  useEffect(() => {
    switch (state.status) {
      case UpdatePatientImageClusterActionStates.DO_NOT_EXIST:
        notifyWarning('Item do not exists!');
        break;
      case UpdatePatientImageClusterActionStates.FAILED:
        notifyError(`Failed to update! ${state.message}`);
        break;
      case UpdatePatientImageClusterActionStates.INVALID_DATA:
        notifyError(`Failed validating your submission! ${state.message}`);
        break;
      case UpdatePatientImageClusterActionStates.SUCCESS:
        notifySuccess('Item updated successfully!');
        router.refresh();
        break;
      default:
        break;
    }
  }, [state]);

  return (
    <ListItem disablePadding>
      <ListItemButton
        LinkComponent={NextLink}
        href={`${paths.patients}/${slug}/${item.cluster}`}
      >
        <ListItemAvatar>
          <Avatar>{isBrocken ? <BrokenImageIcon /> : <ImageIcon />}</Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={
            isBrocken
              ? `Brocken images`
              : item.name || `Cluster ${item.cluster}`
          }
          secondary={
            item.studyDate
              ? `Study date: ${format(item.studyDate, 'dd/MM/yyyy HH:mm:sss')}`
              : ''
          }
        />
        {!!item.images?.length && (
          <Chip
            label={`${item.images.length} ${pluralize(
              'image',
              item.images.length
            )}`}
          />
        )}
      </ListItemButton>
      <FormControlLabel
        sx={{ pl: 4 }}
        control={
          <Switch
            color="primary"
            onChange={handleToggle(item.id, !item.inReview)}
            checked={item.inReview}
          />
        }
        label="In review"
      />
    </ListItem>
  );
};
