import { FC } from 'react';

import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PermMediaIcon from '@mui/icons-material/PermMedia';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { Chip, Stack } from '@mui/material';
import { PatientImageCluster } from '@/types';
import pluralize from 'pluralize';
import { format } from 'date-fns';

interface PatientImagesTagsProps {
  imagesCluster: PatientImageCluster;
}

export const PatientImagesTags: FC<PatientImagesTagsProps> = ({
  imagesCluster,
}) => {
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Chip
        icon={<LocalOfferIcon />}
        color={imagesCluster.cluster === -1 ? 'error' : 'primary'}
        label={imagesCluster.name}
      />
      {!!imagesCluster.images?.length && (
        <Chip
          color="secondary"
          icon={<PermMediaIcon />}
          label={`${imagesCluster.images.length} ${pluralize(
            'image',
            imagesCluster.images.length
          )}`}
        ></Chip>
      )}
      {!!imagesCluster.studyDate && (
        <Chip
          icon={<CalendarMonthIcon />}
          label={format(imagesCluster.studyDate, 'dd/MM/yyyy HH:mm:sss')}
        />
      )}
    </Stack>
  );
};
