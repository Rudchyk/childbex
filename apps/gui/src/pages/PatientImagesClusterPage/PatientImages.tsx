import { FC, useMemo, useState } from 'react';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import {
  Box,
  Divider,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { PatientImagesTags } from './PatientImagesTags';
import { PatientImageReview } from './PatientImageReview';
import { generatePath } from 'react-router-dom';
import { apiRoutes } from '@libs/constants';
import { GetPatientClusterResponse } from '@libs/schemas';
import { DicomViewer } from '../../components';
import { apiBaseUrl } from '../../store/apis';
import { keycloakAuthHeaders } from '../../modules/archiveUpload/httpTransport';

interface PatientImagesProps {
  data: GetPatientClusterResponse;
}

/** Files are only served by the authenticated API (never from `source`). */
const getImageFileUrl = (patientId: string, imageId: string) =>
  apiBaseUrl +
  generatePath(apiRoutes.patientImageFile, { id: patientId, imageId });

export const PatientImages: FC<PatientImagesProps> = ({ data }) => {
  // Keyed by file URL: the viewer reports loaded items by their URL.
  const itemsMapping = useMemo(
    () =>
      Object.fromEntries(
        data.images.map((item) => [
          getImageFileUrl(data.patientId, item.id),
          item,
        ])
      ),
    [data]
  );
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const sources = Object.keys(itemsMapping);
  const [currentSource, setCurrentSource] = useState<string | undefined>();
  const onCurrentItemChange = (newCurrentSource: string) => {
    setCurrentSource(newCurrentSource);
  };
  return (
    <>
      {!matches && (
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
      )}
      <DicomViewer
        list={sources}
        getRequestHeaders={keycloakAuthHeaders}
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
