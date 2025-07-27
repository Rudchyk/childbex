'use client';

import { DicomViewer } from '@/lib/components';
import { FC, useMemo, useState } from 'react';
import { PatientImage, PatientImageCluster } from '@/types';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { Box, Divider, Paper, Typography } from '@mui/material';
import { PatientImagesTags } from './PatientImagesTags';
import { PatientImageReview } from './PatientImageReview';

interface PatientImagesProps {
  data: PatientImage[];
  imagesCluster: PatientImageCluster;
}

export const PatientImages: FC<PatientImagesProps> = ({
  data,
  imagesCluster,
}) => {
  const itemsMapping = useMemo(
    () => Object.fromEntries(data.map((item) => [item.source, item])),
    [data]
  );
  const [currentSource, setCurrentSource] = useState<string | undefined>();
  const onCurrentItemChange = (newCurrentSource: string) => {
    setCurrentSource(newCurrentSource);
  };
  return (
    <>
      <Box
        component={Paper}
        elevation={3}
        sx={{
          position: 'fixed',
          top: '10%',
          bottom: '10%',
          left: 5,
          width: 300,
          zIndex: 50,
        }}
      >
        <Box height="100%" overflow="auto">
          <Typography variant="subtitle1" px={1} pt={1}>
            Tags:
          </Typography>
          <PatientImagesTags
            slotsProps={{
              StackProps: {
                direction: 'column',
                alignItems: 'start',
                spacing: 1,
                px: 1,
                pb: 1,
              },
            }}
            imagesCluster={imagesCluster}
          />
          <Divider />
          {imagesCluster.inReview &&
            !!currentSource &&
            !!itemsMapping[currentSource] && (
              <PatientImageReview item={itemsMapping[currentSource]} />
            )}
        </Box>
      </Box>
      <DicomViewer
        list={data.map(({ source }) => source)}
        onCurrentItemChange={onCurrentItemChange}
        sidebarItemIcon={(source: string) =>
          itemsMapping[source].isAbnormal ? (
            <AcUnitIcon />
          ) : (
            <InsertDriveFileIcon />
          )
        }
      />
    </>
  );
};
