import { FC, useCallback, useMemo, useState } from 'react';
import { Box, Divider, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import type { PatientSeriesResponse } from '@libs/schemas';
import { DicomViewer, type DicomViewerSidebarRenderProps } from '../../components';
import { apiBaseUrl } from '../../store/apis';
import { keycloakAuthHeaders } from '../../modules/archiveUpload/httpTransport';
import { useAuth } from '../../auth/useAuth';
import { PatientImageReview } from './review/PatientImageReview';
import { LLMCheckItems } from './LLMCheckItems';
import { CompleteSeriesReview } from './CompleteSeriesReview';
import { SeriesSliceList, type SliceRow } from './review/SeriesSliceList';
import { BulkReviewActions } from './review/BulkReviewActions';
import { useSliceSelection } from './review/sliceSelection';
import { completionOf, countOwnVotes, opinionOf } from './review/reviewOpinions';

interface SeriesImagesProps {
  data: PatientSeriesResponse;
}

type SeriesImage = PatientSeriesResponse['images'][number];

interface SliceListPanelProps extends DicomViewerSidebarRenderProps {
  data: PatientSeriesResponse;
  /** Viewer source (file URL) -> image. */
  imagesBySource: Record<string, SeriesImage>;
  reviewerId?: string;
  canVote: boolean;
}

/**
 * The selectable slice list next to the viewer: the active slice follows
 * the viewer; checkboxes select (never navigate); bulk actions apply the
 * current doctor's vote to the selection.
 */
const SliceListPanel: FC<SliceListPanelProps> = ({
  data,
  items,
  currentImageId,
  jumpTo,
  imagesBySource,
  reviewerId,
  canVote,
}) => {
  // Top of the list = last slice (as the viewer's file list always showed).
  const rows = useMemo<SliceRow[]>(
    () =>
      [...items]
        .reverse()
        .flatMap(({ source, index }) => {
          const image = imagesBySource[source];
          return image
            ? [
                {
                  id: image.id,
                  index,
                  instanceNumber: image.instanceNumber,
                  opinion: opinionOf(image, reviewerId),
                  reviewState: image.reviewState,
                },
              ]
            : [];
        }),
    [items, imagesBySource, reviewerId]
  );
  const ids = useMemo(() => rows.map(({ id }) => id), [rows]);
  const selection = useSliceSelection(ids);
  const activeId = useMemo(() => {
    const source = items.find(({ imageUid }) => imageUid === currentImageId)?.source;
    return source ? imagesBySource[source]?.id : undefined;
  }, [items, currentImageId, imagesBySource]);

  if (!rows.length) return null;

  return (
    <Box
      component={Paper}
      elevation={3}
      sx={{ position: 'fixed', top: '10%', bottom: '10%', right: 5, width: 270, zIndex: 50 }}
    >
      <SeriesSliceList
        rows={rows}
        activeId={activeId}
        selected={selection.selected}
        onToggle={selection.toggle}
        onToggleAll={selection.toggleAll}
        onNavigate={jumpTo}
        header={
          canVote ? (
            <BulkReviewActions
              patientId={data.patient.id}
              seriesId={data.series.id}
              selectedIds={selection.selectedIds}
              onSaved={selection.clear}
            />
          ) : null
        }
      />
    </Box>
  );
};

/**
 * Viewer and review of a Series that is one simple stack. Broken images are
 * never handed to the viewer; Complete review is enabled only once every
 * presented image was loaded without errors.
 */
export const SeriesImages: FC<SeriesImagesProps> = ({ data }) => {
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const { userId, isDoctor, isAdmin } = useAuth();
  const canVote = isDoctor || isAdmin;
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
  // The viewer loads its list once (on mount): a refetch after a vote never
  // reloads it, so the slice on screen, zoom and window/level are kept.
  const [sources] = useState(() => Object.keys(itemsMapping));
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
  const ownVotes = useMemo(() => countOwnVotes(presented, userId), [presented, userId]);

  const renderSidebar = useCallback(
    (props: DicomViewerSidebarRenderProps) => (
      <SliceListPanel
        {...props}
        data={data}
        imagesBySource={itemsMapping}
        reviewerId={userId}
        canVote={canVote}
      />
    ),
    [data, itemsMapping, userId, canVote]
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        {canVote && (
          <CompleteSeriesReview
            patientId={data.patient.id}
            seriesId={data.series.id}
            presentedImageIds={presented.map(({ id }) => id)}
            disabledReason={disabledReason}
            completion={completionOf(data, userId)}
            ownVotes={ownVotes}
          />
        )}
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
          renderSidebar={renderSidebar}
        />
      )}
    </Stack>
  );
};
