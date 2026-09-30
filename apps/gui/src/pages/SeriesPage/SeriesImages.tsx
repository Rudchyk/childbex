import { FC, useMemo, useState } from 'react';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { Box, Divider, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ReviewState, type PatientSeriesResponse } from '@libs/schemas';
import { DicomViewer } from '../../components';
import { apiBaseUrl } from '../../store/apis';
import { keycloakAuthHeaders } from '../../modules/archiveUpload/httpTransport';
import { PatientImageReview } from './review/PatientImageReview';
import { LLMCheckItems } from './LLMCheckItems';
import { FinishSeriesReview } from './FinishSeriesReview';

interface SeriesImagesProps {
  data: PatientSeriesResponse;
}

/**
 * Viewer and review of a Series that is one simple stack. Broken images are
 * never handed to the viewer; Finish review is enabled only once every
 * presented image was loaded without errors.
 */
export const SeriesImages: FC<SeriesImagesProps> = ({ data }) => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const presented = useMemo(
    () => data.images.filter((image) => !image.isBroken),
    [data]
  );
  // Keyed by file URL: the viewer reports loaded items by their URL. Files
  // come only from the authenticated API.
  const itemsMapping = useMemo(
    () =>
      Object.fromEntries(
        presented.map((image) => [apiBaseUrl + image.fileUrl, image])
      ),
    [presented]
  );
  const sources = Object.keys(itemsMapping);
  const [currentSource, setCurrentSource] = useState<string | undefined>();
  const [loadResult, setLoadResult] = useState<{
    sliceCount: number;
    errorCount: number;
  }>();
  const fullyLoaded =
    !!loadResult &&
    loadResult.errorCount === 0 &&
    loadResult.sliceCount === presented.length;
  const disabledReason = !presented.length
    ? 'No images to review'
    : !loadResult
      ? 'Waiting until every image of the series is loaded'
      : !fullyLoaded
        ? 'Not every image of the series could be shown'
        : undefined;
  const currentImage = currentSource ? itemsMapping[currentSource] : undefined;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <FinishSeriesReview
          patientId={data.patient.id}
          seriesId={data.series.id}
          presentedImageIds={presented.map(({ id }) => id)}
          disabledReason={disabledReason}
        />
        <LLMCheckItems
          patientId={data.patient.id}
          seriesId={data.series.id}
          items={presented.map(({ id }) => id)}
        />
      </Stack>
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
              Review:
            </Typography>
            <Divider />
            {!!currentImage && <PatientImageReview item={currentImage} />}
          </Box>
        </Box>
      )}
      {!!sources.length && (
        <DicomViewer
          list={sources}
          getRequestHeaders={keycloakAuthHeaders}
          onCurrentItemChange={setCurrentSource}
          onLoadResult={setLoadResult}
          sidebarItemIcon={(source: string) =>
            itemsMapping[source]?.reviewState === ReviewState.ABNORMAL ? (
              <AcUnitIcon />
            ) : (
              <InsertDriveFileIcon />
            )
          }
        />
      )}
    </Stack>
  );
};
