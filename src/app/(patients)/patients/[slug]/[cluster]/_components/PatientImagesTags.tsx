import { FC } from 'react';

import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PermMediaIcon from '@mui/icons-material/PermMedia';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { Chip, Stack, StackProps } from '@mui/material';
import { PatientImageCluster } from '@/types';
import pluralize from 'pluralize';
import { format } from 'date-fns';
import { defaultDateFormat } from '@/lib/constants/dates';

interface PatientImagesTagsProps {
  imagesCluster: PatientImageCluster;
  slotsProps?: {
    StackProps: StackProps;
  };
}

export const PatientImagesTags: FC<PatientImagesTagsProps> = ({
  imagesCluster,
  slotsProps,
}) => {
  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      {...slotsProps?.StackProps}
    >
      <Chip
        icon={<LocalOfferIcon fontSize="small" />}
        color={imagesCluster.cluster === -1 ? 'error' : 'primary'}
        label={imagesCluster.name}
      />
      {!!imagesCluster.images?.length && (
        <Chip
          color="secondary"
          icon={<PermMediaIcon fontSize="small" />}
          label={`${imagesCluster.images.length} ${pluralize(
            'image',
            imagesCluster.images.length
          )}`}
        ></Chip>
      )}
      {!!imagesCluster.studyDate && (
        <Chip
          icon={<CalendarMonthIcon fontSize="small" />}
          label={format(imagesCluster.studyDate, defaultDateFormat)}
        />
      )}
    </Stack>
  );
};
