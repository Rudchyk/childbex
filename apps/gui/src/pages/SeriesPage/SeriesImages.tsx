import { FC, useCallback, useMemo, useState } from 'react';
import { Box, Divider, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
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
import { ReviewSidePanel } from './review/ReviewSidePanel';

interface SeriesImagesProps {
  data: PatientSeriesResponse;
}

type SeriesImage = PatientSeriesResponse['images'][number];

/** Expanded side panel widths (side by side). */
export const REVIEW_PANEL_WIDTH = 300;
export const SLICE_PANEL_WIDTH = 270;
/**
 * From this breakpoint the panels sit next to the viewer; below it they are
 * stacked under it, so the image keeps a usable width (at 1200px both
 * expanded panels still leave the viewport about 560px).
 */
export const SIDE_BY_SIDE_BREAKPOINT = 'lg';

interface SliceListPanelProps extends DicomViewerSidebarRenderProps {
  data: PatientSeriesResponse;
  /** Viewer source (file URL) -> image. */
  imagesBySource: Record<string, SeriesImage>;
  reviewerId?: string;
  canVote: boolean;
  /** Below the viewport instead of next to it. */
  stacked: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * The selectable slice list next to the viewer: the active slice is only
 * ever the one the viewer reports on screen; a checkbox click selects and
 * asks the viewer to show that slice; Select all and bulk actions never
 * navigate; bulk actions apply the current doctor's vote to the selection.
 * Always rendered (also while collapsed or loading), so the selection
 * survives collapsing it.
 */
const SliceListPanel: FC<SliceListPanelProps> = ({
  data,
  items,
  currentImageId,
  jumpTo,
  imagesBySource,
  reviewerId,
  canVote,
  stacked,
  expanded,
  onToggle,
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

  return (
    <ReviewSidePanel
      id="series-slice-list"
      title="Slices"
      name="slice list"
      side="right"
      stacked={stacked}
      width={SLICE_PANEL_WIDTH}
      expanded={expanded}
      onToggle={onToggle}
      // Below the viewport: a bounded, scrollable list.
      stackedHeight="60vh"
    >
      {rows.length ? (
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
      ) : (
        <Typography variant="body2" color="text.secondary" p={1}>
          No slices loaded yet.
        </Typography>
      )}
    </ReviewSidePanel>
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
  // Read at the first render (no flip after mount). Only props change with
  // it, never the tree: the viewer and the panels stay mounted.
  const sideBySide = useMediaQuery(theme.breakpoints.up(SIDE_BY_SIDE_BREAKPOINT), {
    noSsr: true,
  });
  const stacked = !sideBySide;
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
  // Layout only, for this Series (never persisted): collapsing a panel
  // hides it but keeps it mounted, with its unsaved input and selection.
  const [reviewPanelOpen, setReviewPanelOpen] = useState(true);
  const [slicePanelOpen, setSlicePanelOpen] = useState(true);
  const toggleReviewPanel = useCallback(() => setReviewPanelOpen((open) => !open), []);
  const toggleSlicePanel = useCallback(() => setSlicePanelOpen((open) => !open), []);

  const renderSidebar = useCallback(
    (props: DicomViewerSidebarRenderProps) => (
      <SliceListPanel
        {...props}
        data={data}
        imagesBySource={itemsMapping}
        reviewerId={userId}
        canVote={canVote}
        stacked={stacked}
        expanded={slicePanelOpen}
        onToggle={toggleSlicePanel}
      />
    ),
    [data, itemsMapping, userId, canVote, stacked, slicePanelOpen, toggleSlicePanel]
  );

  const reviewPanel = (
    <ReviewSidePanel
      id="series-review-panel"
      title="Review"
      name="review panel"
      side="left"
      stacked={stacked}
      width={REVIEW_PANEL_WIDTH}
      expanded={reviewPanelOpen}
      onToggle={toggleReviewPanel}
    >
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
    </ReviewSidePanel>
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
      {/*
        The panels take their own room on both sides of the viewer (no
        overlay), so a collapsed panel gives its width to the viewport. Below
        SIDE_BY_SIDE_BREAKPOINT they are stacked under the viewer. The review
        panel is always the viewer's leading panel (it never moves to another
        parent, so it is never remounted).
      */}
      <Box data-testid="series-review-workspace" data-layout={stacked ? 'stacked' : 'side'}>
        {sources.length ? (
          <DicomViewer
            list={sources}
            getRequestHeaders={keycloakAuthHeaders}
            onCurrentItemChange={onCurrentItemChange}
            onLoadResult={setLoadResult}
            leadingPanel={reviewPanel}
            renderSidebar={renderSidebar}
            sidebarPlacement={stacked ? 'below' : 'beside'}
          />
        ) : (
          reviewPanel
        )}
      </Box>
    </Stack>
  );
};
