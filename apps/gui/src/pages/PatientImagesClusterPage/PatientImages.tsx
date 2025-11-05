import { FC, useMemo, useState } from 'react';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { Box, Divider, Paper, Typography } from '@mui/material';
import { PatientImagesTags } from './PatientImagesTags';
import { PatientImageReview } from './PatientImageReview';
import { GetPatientClusterResponse } from '@libs/schemas';
import { DicomViewer } from '../../components';

interface PatientImagesProps {
  data: GetPatientClusterResponse;
}

export const PatientImages: FC<PatientImagesProps> = ({ data }) => {
  const itemsMapping = useMemo(
    () => Object.fromEntries(data.images.map((item) => [item.source, item])),
    [data]
  );
  const sources = data.images.map(({ source }) => source);
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
            imagesCluster={data}
          />
          <Divider />
          {data.inReview &&
            !!currentSource &&
            !!itemsMapping[currentSource] && (
              <PatientImageReview item={itemsMapping[currentSource]} />
            )}
        </Box>
      </Box>
      <DicomViewer
        list={sources}
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
