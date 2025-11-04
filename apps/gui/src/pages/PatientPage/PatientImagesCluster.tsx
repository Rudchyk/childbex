import { FC, useEffect } from 'react';
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
import ImageIcon from '@mui/icons-material/Image';
import { format } from 'date-fns';
import pluralize from 'pluralize';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import { GetPatientResponse } from '@libs/schemas';
import { Link as RouteLink } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import { useUpdatePatientAssetMutation } from '../../store/apis';
import { useNotifications } from '../../modules/notifications';

interface PatientImagesClusterProps {
  item: GetPatientResponse['clusters'][0];
  slug: string;
}

export const PatientImagesCluster: FC<PatientImagesClusterProps> = ({
  item,
  slug,
}) => {
  const { notifyError, notifySuccess } = useNotifications();
  const isBrocken = item.cluster === -1;
  const [updatePatientAsset, { isError, error, isSuccess }] =
    useUpdatePatientAssetMutation();
  const handleToggle = (id: string, newValue: boolean) => () => {
    updatePatientAsset({
      id,
      inReview: newValue,
    });
  };
  useEffect(() => {
    if (isError) {
      notifyError(error);
    }
  }, [isError]);

  useEffect(() => {
    if (isSuccess) {
      notifySuccess(`Cluster ${item.name} was updated successfully!`);
    }
  }, [isSuccess]);

  return (
    <ListItem disablePadding>
      <ListItemButton
        component={RouteLink}
        to={guiRoutes.patientImagesCluster
          .replace(':slug', slug)
          .replace(':cluster', String(item.cluster))}
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
            disabled={isBrocken}
            onChange={handleToggle(item.id, !item.inReview)}
            checked={item.inReview}
          />
        }
        label="In review"
      />
    </ListItem>
  );
};
