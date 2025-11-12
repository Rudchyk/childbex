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
  useMediaQuery,
  useTheme,
  Stack,
  Divider,
} from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import { format } from 'date-fns';
import pluralize from 'pluralize';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import { GetPatientResponse } from '@libs/schemas';
import { generatePath, Link as RouteLink } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import { useUpdatePatientImagesClusterMutation } from '../../store/apis';
import { useNotifications } from '../../modules/notifications';
import { DeletePatientImagesCluster } from './DeletePatientImagesCluster';

interface PatientImagesClusterProps {
  item: GetPatientResponse['clusters'][0];
  slug: string;
}

export const PatientImagesCluster: FC<PatientImagesClusterProps> = ({
  item,
  slug,
}) => {
  const { notifyError, notifySuccess } = useNotifications();
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const isBrocken = item.cluster === -1;
  const [updatePatientAsset, { isError, error, isSuccess }] =
    useUpdatePatientImagesClusterMutation();
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
    <ListItem disablePadding sx={{ display: matches ? 'block' : 'flex' }}>
      <ListItemButton
        component={RouteLink}
        to={generatePath(guiRoutes.patientImagesCluster, {
          slug,
          cluster: String(item.cluster),
        })}
      >
        {!matches && (
          <ListItemAvatar>
            <Avatar>{isBrocken ? <BrokenImageIcon /> : <ImageIcon />}</Avatar>
          </ListItemAvatar>
        )}
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
      <Stack
        direction="row"
        justifyContent={matches ? 'space-between' : 'start'}
        sx={{
          width: { sm: matches ? '100%' : 'auto' },
          px: matches ? 2 : 0,
          pb: matches ? 2 : 0,
        }}
      >
        <FormControlLabel
          sx={{ pl: matches ? 0 : 4 }}
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
        <DeletePatientImagesCluster id={item.id} />
      </Stack>
      {matches && <Divider />}
    </ListItem>
  );
};
