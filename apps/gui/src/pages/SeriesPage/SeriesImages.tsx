import { FC, useCallback, useMemo, useState } from 'react';
import { Box, Divider, Paper, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import type { PatientSeriesResponse } from '@libs/schemas';
import {
  DicomViewer,
  type DicomLoadResult,
  type DicomSlicePosition,
  type DicomViewerSidebarRenderProps,
} from '../../components';
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

/** The slice on screen, as reported by the viewer. */
interface ActiveSlice {
  source?: string;
  position?: DicomSlicePosition;
}

/**
 * "Slice 120 / 249 loaded · Instance #157": the position in the loaded
 * volume (the slice list's numbering), not in the Series, and the DICOM
 * Instance Number. No patient identifiers.
 */
export const sliceLabel = (
  position: DicomSlicePosition,
  instanceNumber: number | null
) =>
  `Slice ${position.index + 1} / ${position.loadedCount} loaded · ` +
  (instanceNumber === null ? 'no Instance #' : `Instance #${instanceNumber}`);

/**
 * Whether the viewer shows exactly the presented images: every presented
 * file once, nothing else, and no load errors. Compared by file URL (it
 * carries the patient and image ids), not only by count.
 */
const showsExactly = (
  result: DicomLoadResult | undefined,
  presentedSources: string[]
) => {
  if (!result || result.errorCount !== 0) return false;
  const loaded = new Set(result.loadedSources);
  return (
    result.sliceCount === presentedSources.length &&
    result.loadedSources.length === presentedSources.length &&
    loaded.size === presentedSources.length &&
    presentedSources.every((source) => loaded.has(source))
  );
};

/**
 * Viewer and review of a Series that is one simple stack. Broken images are
 * never handed to the viewer; Complete review is enabled only once the
 * viewer verifiably shows every presented image (and nothing else) without
 * errors. Its state belongs to one Series: render it keyed by patient and
 * Series.
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
  const [active, setActive] = useState<ActiveSlice>({});
  const onCurrentItemChange = useCallback(
    (source: string | undefined, position?: DicomSlicePosition) =>
      setActive((state) =>
        state.source === source &&
        state.position?.index === position?.index &&
        state.position?.loadedCount === position?.loadedCount
          ? state
          : { source, position }
      ),
    []
  );
  const [loadResult, setLoadResult] = useState<DicomLoadResult>();
  const fullyLoaded = showsExactly(loadResult, Object.keys(itemsMapping));
  const disabledReason = !presented.length
    ? 'No images to review'
    : !loadResult
      ? 'Waiting until every image of the series is loaded'
      : !fullyLoaded
        ? 'Not every image of the series could be shown'
        : undefined;
  // Only an image of this Series, at a known position in the loaded volume:
  // the header, the vote form and the vote request all use this one image.
  const currentImage = active.source ? itemsMapping[active.source] : undefined;
  const currentLabel =
    currentImage && active.position
      ? sliceLabel(active.position, currentImage.instanceNumber)
      : undefined;
  const partiallyLoaded =
    !!active.position && active.position.loadedCount < presented.length;
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
            <Typography variant="subtitle1" px={1} pt={1} data-testid="review-header">
              Review —{' '}
              {currentLabel ??
                (currentImage ? 'locating the slice on screen…' : 'no slice shown yet')}
            </Typography>
            {partiallyLoaded && (
              <Typography variant="caption" color="warning.main" px={1} component="div">
                Only {active.position?.loadedCount} of {presented.length} images
                of this series are loaded.
              </Typography>
            )}
            <Divider />
            {!!currentImage && !!currentLabel && (
              <PatientImageReview item={currentImage} targetLabel={currentLabel} />
            )}
          </Box>
        </Box>
      )}
      {!!sources.length && (
        <DicomViewer
          list={sources}
          getRequestHeaders={keycloakAuthHeaders}
          onCurrentItemChange={onCurrentItemChange}
          onLoadResult={setLoadResult}
          renderSidebar={renderSidebar}
        />
      )}
    </Stack>
  );
};
