import {
  FC,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  Box,
  LinearProgress,
  Stack,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  App,
  AppOptions,
  DataElement,
  Index,
  Point2D,
  ViewConfig,
  custom,
} from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';
import { DicomViewerSidebar, type Item } from './DicomViewerSidebar';
import {
  DicomLoadErrorEvent,
  DicomLoadItemEvent,
  DicomLoadProgressEvent,
  DicomPositionChangeEvent,
  DicomLoadEndEvent,
} from './DicomViewer.types';

import './DicomViewer.css';
import { getImageUid } from './DicomViewer.utils';
import {
  createLoadTracker,
  loadStatus,
  missingInputs,
  type LoadSummary,
  type LoadTracker,
} from './DicomViewer.loadAccount';
import { presentLoadError, type DicomLoadError } from './DicomViewer.loadErrors';
import { DicomViewerDropbox } from './DicomViewerDropbox';
import {
  getLengthCalibration,
  measurementLabelTexts,
  type LengthCalibration,
} from './DicomViewer.calibration';
import {
  actualPixelsZoom,
  effectivePixelRatio,
  hiDpiLayout,
  type HiDpiLayout,
} from './DicomViewer.display';
import { refitKeepingView, type ContainerSize } from './DicomViewer.refit';

/** What a custom slice list gets from the viewer. */
export interface DicomViewerSidebarRenderProps {
  /** The loaded slices (dwv order: `index` is the slice index). */
  items: Item[];
  /** SOP Instance UID of the slice on screen. */
  currentImageId?: string;
  /** Shows the slice with this index. */
  jumpTo: (index: number) => void;
}

/** Where the slice on screen is in the loaded volume (not in the Series). */
export interface DicomSlicePosition {
  /** Zero-based slice index in the loaded volume (dwv order). */
  index: number;
  /** Slices in the loaded volume. */
  loadedCount: number;
}

/** The outcome of loading `list`. */
export interface DicomLoadResult {
  /** Slices in the loaded volume. */
  sliceCount: number;
  /** Load errors so far (any error: never a complete load). */
  errorCount: number;
  /**
   * Of these, dwv's metadata merge errors: reported after it stored the
   * image (DICOM details not merged, e.g. duplicate or missing Instance
   * Numbers), so the image is shown but its metadata may be incomplete.
   */
  metadataErrorCount: number;
  /** The `list` entry of each loaded slice (by slice index). */
  loadedSources: string[];
}

interface DicomViewerProps {
  list?: string[];
  /**
   * Headers for loading `list` (e.g. `authorization` for protected URLs).
   * Resolved once, right before the URLs are loaded.
   */
  getRequestHeaders?: () => Promise<Record<string, string>>;
  isClean?: boolean;
  /**
   * The slice on screen: its `list` entry (undefined while unresolved) and,
   * once the volume is loaded, its position in the loaded volume.
   */
  onCurrentItemChange?: (
    source: string | undefined,
    position?: DicomSlicePosition
  ) => void;
  toolbar?: ReactElement | ReactNode;
  sidebarItemIcon?: (source: string) => ReactElement;
  /** Replaces the default file list (e.g. a selectable slice list). */
  renderSidebar?: (props: DicomViewerSidebarRenderProps) => ReactNode;
  /**
   * A panel on the other side of the viewport (e.g. a review form): left
   * of it when beside, after the sidebar when below.
   */
  leadingPanel?: ReactNode;
  /**
   * Where `leadingPanel` and `renderSidebar` go: next to the toolbar and
   * viewport (as high as both) or below them (e.g. where the viewport would
   * be too narrow otherwise).
   */
  sidebarPlacement?: 'beside' | 'below';
  /**
   * Called when loading `list` ended or failed: the slices in the loaded
   * volume, the load errors so far and which `list` entries the slices are
   * (to tell whether everything in `list` is actually shown).
   */
  onLoadResult?: (result: DicomLoadResult) => void;
}

/** The viewer's tools: dwv tools, and the two Draw shapes as their own tools. */
export const VIEWER_TOOLS = [
  'Scroll',
  'WindowLevel',
  'ZoomAndPan',
  'Ruler',
  'Rectangle',
] as const;
export type ViewerTool = (typeof VIEWER_TOOLS)[number];

/** Draw shapes (dwv shape names): length and the existing area tool. */
const DRAW_SHAPES: readonly ViewerTool[] = ['Ruler', 'Rectangle'];

const dwvTools: AppOptions['tools'] = {
  Scroll: { options: undefined },
  WindowLevel: { options: undefined },
  ZoomAndPan: { options: undefined },
  Draw: { options: ['Ruler', 'Rectangle'] },
};

/** dwv's draw style (`App#getStyle`), the parts the viewer adapts. */
interface DwvStyle {
  applyZoomScale(value: number): { x: number; y: number };
  getStrokeWidth(): number;
}

/** The pixel ratio dwv's draw styles scale screen-constant sizes by. */
let drawStylePixelRatio = 1;

/**
 * Keeps labels, anchors and strokes at their CSS size on the high-DPI
 * container. dwv's tools each own a Style instance (the Draw tool too), so
 * the shared Style class is adapted once, through the app's instance.
 */
const scaleDrawStyles = (style: DwvStyle | undefined) => {
  const proto = style && (Object.getPrototypeOf(style) as DwvStyle & { __hiDpi?: true });
  if (
    !proto ||
    proto.__hiDpi ||
    !Object.prototype.hasOwnProperty.call(proto, 'applyZoomScale') ||
    !Object.prototype.hasOwnProperty.call(proto, 'getStrokeWidth')
  ) {
    return;
  }
  const { applyZoomScale, getStrokeWidth } = proto;
  proto.applyZoomScale = function (this: DwvStyle, value: number) {
    return applyZoomScale.call(this, value * drawStylePixelRatio);
  };
  proto.getStrokeWidth = function (this: DwvStyle) {
    return getStrokeWidth.call(this) * drawStylePixelRatio;
  };
  proto.__hiDpi = true;
};

const VIEWPORT_HEIGHT ='max(500px, calc(100vh - 280px))';

/**
 * https://ivmartel.github.io/dwv/
 * https://github.com/ivmartel/dwv
 * https://github.com/ivmartel/dwv-react
 * TODO: create grouping by seriesDescription for files
 */

/** `activeDataIdRef` while the previous load is removed (no dwv data id). */
const REPLACED_LOAD = 'replaced';
const LOCAL_LOAD_FAILED =
  'The images could not be displayed. Choose another Series or other files.';

/** An event of a load that was replaced or cleaned in the meantime. */
const isStaleLoadEvent = (activeDataId: string | undefined, event: unknown) => {
  const dataId = (event as { dataid?: unknown } | null)?.dataid;
  return activeDataId !== undefined && dataId !== undefined && `${dataId}` !== activeDataId;
};

const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, word: string) =>
  `${count(value)} ${word}${value === 1 ? '' : 's'}`;

/**
 * What the shown local stack is, from what dwv actually stored (never from
 * its `loadend` alone): still being completed, not the complete Series, or
 * complete images whose DICOM details dwv could not merge. The image count
 * is dwv's own (its slices).
 */
const LocalLoadStatus: FC<{ summary: LoadSummary; sliceCount: number }> = ({
  summary,
  sliceCount,
}) => {
  const status = loadStatus(summary);
  const shown = plural(sliceCount, 'image');
  if (status === 'pending') {
    return (
      <Alert severity="info" data-testid="local-load-pending">
        Still adding images:{' '}
        {summary.attributed
          ? `${count(summary.stored + summary.failed)} of ${count(summary.expected)} files processed`
          : `${plural(summary.expected, 'file')} handed to the viewer`}{' '}
        ({shown} shown so far).
      </Alert>
    );
  }
  if (status !== 'issues') return null;
  const missing = missingInputs(summary);
  const metadata = summary.storedWithErrors;
  return (
    <>
      {missing !== 0 && (
        <Alert severity="warning" data-testid="local-load-incomplete">
          <strong>Incomplete stack:</strong>{' '}
          {missing === undefined
            ? `${plural(summary.errorEvents, 'load error')} could not all be matched to files, so images may be missing`
            : `${count(missing)} of ${plural(summary.expected, 'file')} could not be added, so this is not the complete Series`}{' '}
          ({shown} shown). Use Clean to choose another Series.
        </Alert>
      )}
      {metadata > 0 && (
        <Alert severity="warning" data-testid="local-load-metadata-errors">
          <strong>DICOM details incomplete:</strong> the images of{' '}
          {plural(metadata, 'file')} were added and are shown, but dwv then reported
          errors for them (e.g. duplicate or missing Instance Numbers), so their
          DICOM details may be incomplete or wrong.
        </Alert>
      )}
      {missing === 0 && metadata === 0 && (
        <Alert severity="warning" data-testid="local-load-errors">
          <strong>Load errors:</strong> {plural(summary.errorEvents, 'error')} reported
          although every file was added ({shown} shown): images or their DICOM
          details may be incomplete.
        </Alert>
      )}
    </>
  );
};

/** The browser's next frame (a timer where frames are not available). */
const requestFrame = (callback: () => void) =>
  typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(callback, 16);
const cancelFrame = (id: number) =>
  typeof window.cancelAnimationFrame === 'function'
    ? window.cancelAnimationFrame(id)
    : window.clearTimeout(id);

/**
 * Frees everything dwv holds: `reset` only empties the display, so each
 * data (decoded volume) is removed with `abortLoad`, which also stops it
 * when still loading. Inputs dwv no longer tracks (after an early
 * `loadend`) may still be read, but cannot recreate removed data: dwv then
 * reports "Cannot find data to update" for them (a stale `error`).
 */
const releaseDwvData = (app: App) => {
  app.abortAllLoads();
  for (const dataId of app.getDataIds()) app.abortLoad(dataId);
  app.reset();
};

export const DicomViewer: FC<DicomViewerProps> = ({
  list = [],
  getRequestHeaders,
  isClean,
  onCurrentItemChange,
  toolbar,
  sidebarItemIcon,
  renderSidebar,
  leadingPanel,
  sidebarPlacement = 'beside',
  onLoadResult,
}) => {
  /** The viewport (CSS size). */
  const viewportRef = useRef<HTMLDivElement | null>(null);
  /** dwv's layer container (device pixels, scaled back by CSS). */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<App>(null);
  const isMountedRef = useRef(false);
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.down('sm'));
  const [layout, setLayout] = useState<HiDpiLayout | null>(null);
  const [loadedItemsMapping, setLoadedItemsMapping] = useState<
    Record<string, string>
  >({});
  const [loadedSlicesMapping, setLoadedSlicesMapping] = useState<
    Record<string, string>
  >({});
  const defaultSelectedTool = 'Select Tool';
  const [items, setItems] = useState<Item[]>([]);
  const [sliceCount, setSliceCount] = useState<number>(0);
  /** Presented errors only (`presentLoadError`), never dwv's raw messages. */
  const [loadErrorEvents, setLoadErrorEvents] = useState<DicomLoadError[]>([]);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoadSuccessful, setIsLoadSuccessful] = useState(false);
  const [isShowDropbox, setIsShowDropbox] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  const [selectedTool, setSelectedTool] = useState(defaultSelectedTool);
  const [canWindowLevel, setCanWindowLevel] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [loadStateError, setLoadStateError] = useState<string | null>(null);
  const [currentMetaData, setCurrentMetaData] = useState<
    Record<string, DataElement>
  >({});
  const [calibration, setCalibration] = useState<LengthCalibration>();
  const [currentImageId, setCurrentImageId] = useState<string | undefined>();
  /** What the current load stored or failed (`DicomViewer.loadAccount`). */
  const [loadAccount, setLoadAccount] = useState<LoadSummary | null>(null);
  const loadTrackerRef = useRef<LoadTracker | null>(null);
  /** Inputs of the load about to start (read on its `loadstart`). */
  const loadInputsRef = useRef<readonly unknown[]>([]);
  /**
   * What dwv reported and is not shown yet: published together, at most
   * once per frame (`reconcileFrameRef`), so a large stack completed after
   * dwv's early `loadend` is not re-read and re-rendered per slice.
   */
  const itemSourcesRef = useRef<Record<string, string>>({});
  const itemSourcesChangedRef = useRef(false);
  const pendingErrorsRef = useRef<DicomLoadError[]>([]);
  const reconcileFrameRef = useRef<number | null>(null);
  /** dwv data id of the load whose (possibly early) `loadend` came. */
  const endedDataIdRef = useRef<string | undefined>(undefined);
  /** dwv data id whose stack is set up in the viewer (tools, metadata). */
  const shownDataIdRef = useRef<string | undefined>(undefined);
  /**
   * dwv data id of the current load (from `loadstart`); events of another
   * load are stale. dwv never reuses data ids.
   */
  const activeDataIdRef = useRef<string | undefined>(undefined);
  const isCleanRef = useRef(isClean);
  isCleanRef.current = isClean;
  /**
   * Whether the view is dwv's fit (it follows the viewport when resized),
   * or zoom/pan the user set (kept on resize in the standalone viewer:
   * `refitKeepingView`).
   */
  const followsFitRef = useRef(true);
  /** Container size dwv was last fitted to (none: not fitted yet). */
  const fittedSizeRef = useRef<ContainerSize | null>(null);
  /** The default image list (standalone viewer): expanded or collapsed. */
  const [isImageListExpanded, setIsImageListExpanded] = useState(true);
  const toggleImageList = useCallback(() => setIsImageListExpanded((value) => !value), []);
  /** Without a custom one, the default image list (not on small screens). */
  const showImageList = !renderSidebar && !matches && items.length > 0;
  /** Panels next to the viewport (without any: full width). */
  const panelsBeside =
    (!!renderSidebar || !!leadingPanel || showImageList) && sidebarPlacement === 'beside';

  const onChangeTool = (tool: string) => {
    if (appRef.current) {
      setSelectedTool(tool);
      if (DRAW_SHAPES.includes(tool as ViewerTool)) {
        appRef.current.setTool('Draw');
        appRef.current.setToolFeatures({ shapeName: tool });
        return;
      }
      appRef.current.setTool(tool);
      const lg = appRef.current.getActiveLayerGroup();
      if (lg) {
        lg.setActiveLayer(0);
      }
    }
  };
  const canRunTool = (tool: string) => {
    switch (tool) {
      case 'Scroll':
        return canScroll;
      case 'WindowLevel':
        return canWindowLevel;
      default:
        return true;
    }
  };
  /** Fit to the viewport (zoom and pan reset). */
  const onReset = () => {
    if (appRef.current) {
      appRef.current.resetZoomPan();
      followsFitRef.current = true;
    }
  };
  /** One image pixel per device pixel, centred ("Actual pixels" 1:1). */
  const onActualPixels = () => {
    const app = appRef.current;
    const container = containerRef.current;
    const layerGroup = app?.getActiveLayerGroup();
    const viewLayer = layerGroup?.getBaseViewLayer();
    if (!app || !container || !layerGroup || !viewLayer) return;
    const viewController = viewLayer.getViewController();
    const size = viewController.getImageSize();
    const spacing = viewController.get2DSpacing();
    const width = container.offsetWidth;
    const height = container.offsetHeight;
    const zoom = actualPixelsZoom(width, height, {
      columns: size.get(0),
      rows: size.get(1),
      columnSpacing: spacing.x,
      rowSpacing: spacing.y,
    });
    if (zoom === null) return;
    app.resetZoomPan();
    const planePos = viewLayer.displayToMainPlanePos(
      new Point2D(width / 2, height / 2)
    );
    layerGroup.addScale(
      zoom - 1,
      viewController.getPlanePositionFromPlanePoint(planePos)
    );
    layerGroup.draw();
  };
  /**
   * Removes the loaded (or still loading) data. Events of an aborted load
   * that arrive later are ignored (`isStaleLoadEvent`).
   */
  const cancelReconcile = () => {
    if (reconcileFrameRef.current === null) return;
    cancelFrame(reconcileFrameRef.current);
    reconcileFrameRef.current = null;
  };
  /** Forgets everything the current load reported but not yet shown. */
  const forgetLoad = () => {
    cancelReconcile();
    loadTrackerRef.current = null;
    endedDataIdRef.current = undefined;
    itemSourcesRef.current = {};
    itemSourcesChangedRef.current = false;
    pendingErrorsRef.current = [];
    shownDataIdRef.current = undefined;
  };
  const resetViewer = () => {
    // Set first: aborting emits events of the old load synchronously too.
    activeDataIdRef.current = REPLACED_LOAD;
    forgetLoad();
    if (appRef.current) releaseDwvData(appRef.current);
    followsFitRef.current = true;
    setLoadAccount(null);
    setItems([]);
    setSliceCount(0);
    setLoadProgress(0);
    setIsLoadSuccessful(false);
    setCurrentImageId(undefined);
    setCurrentMetaData({});
    setCalibration(undefined);
    setIsDataLoaded(false);
    setLoadStateError(null);
    setCanWindowLevel(false);
    setSelectedTool(defaultSelectedTool);
    setCanScroll(false);
    setLoadedSlicesMapping({});
    setLoadedItemsMapping({});
    setLoadErrorEvents([]);
  };
  const onClean = () => {
    resetViewer();
    setIsShowDropbox(true);
  };
  /**
   * One local stack (standalone mode). The previous one is removed first,
   * so two loads never mix; Clean, or a failed load, shows the import again.
   */
  const onLoadFiles = (files: File[]) => {
    const app = appRef.current;
    if (!app) return;
    resetViewer();
    setIsShowDropbox(false);
    loadInputsRef.current = files;
    try {
      app.loadFiles(files);
    } catch {
      // e.g. no dwv loader for the files: nothing will be loaded.
      setLoadStateError(LOCAL_LOAD_FAILED);
      setIsShowDropbox(true);
    }
  };
  // Stable: memoised slice rows receive it. Only a request: nothing loaded
  // yet (no view layer) or an index out of the volume changes nothing, and
  // the slice on screen is still only what dwv reports (positionchange).
  const jumpTo = useCallback((i: number) => {
    // dwv's bounds check lets a NaN index through.
    if (!Number.isInteger(i) || i < 0) return;
    const lg = appRef.current?.getActiveLayerGroup();
    const vl = lg?.getActiveViewLayer();
    if (vl) {
      const vc = vl.getViewController();
      const vals = vc.getCurrentIndex().getValues();
      vals[2] = i;
      vc.setCurrentIndex(new Index(vals), false);
    }
  }, []);

  // High-DPI container: sized before dwv first fits the image, and on
  // every viewport resize or pixel-ratio change.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(any-pointer: coarse)').matches;
    const update = () => {
      const ratio = effectivePixelRatio(window.devicePixelRatio, coarse);
      drawStylePixelRatio = ratio;
      setLayout(hiDpiLayout(viewport.clientWidth, viewport.clientHeight, ratio));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // dwv reads the container size when it fits: refit after a change. The
  // fit follows the viewport. In the standalone viewer only (Issue #57),
  // zoom/pan the user set (e.g. "Actual pixels") keeps its magnification
  // and centre; the Series review keeps dwv's own refit (zoom relative to
  // the fit).
  useEffect(() => {
    const app = appRef.current;
    if (!isDataLoaded) fittedSizeRef.current = null;
    if (!layout || !isDataLoaded || !app) return;
    const previous = fittedSizeRef.current;
    const next = { width: layout.width, height: layout.height };
    fittedSizeRef.current = next;
    // (dwv's fit emits no zoom/pan events; keeping the view does, but only
    // runs once the view no longer follows the fit.)
    if (!isCleanRef.current || followsFitRef.current || !previous) app.fitToContainer();
    else refitKeepingView(app, previous, next);
  }, [layout, isDataLoaded]);

  useEffect(() => {
    isMountedRef.current = true;
    if (appRef.current) {
      return () => {
        isMountedRef.current = false;
      };
    }

    const app = new App();
    const viewConfig0 = new ViewConfig(containerRef?.current?.id ?? '');
    const viewConfigs = { '*': [viewConfig0] };
    const options = new AppOptions(viewConfigs);
    options.tools = dwvTools;
    app.init(options);

    // Draw layers render at one canvas pixel per device pixel already
    // (high-DPI container): no extra Konva pixel ratio on top of it.
    const konva = (window as { Konva?: { pixelRatio: number } }).Konva;
    if (konva) konva.pixelRatio = 1;
    scaleDrawStyles(app.getStyle() as DwvStyle | undefined);

    /**
     * What dwv's image of a load holds (all frames): tells whether an input
     * was stored before dwv reported an error for it.
     */
    const storedSize = (dataId: unknown) =>
      app.getData(`${dataId}`)?.image?.getGeometry().getSize().getTotalSize() ?? 0;

    /**
     * Puts the stack dwv holds now into the viewer: slice count and slice
     * UIDs every time (slices can still be appended after dwv's `loadend`),
     * tools and the "loaded" state once per load. False when dwv has
     * nothing to show (yet).
     */
    const showStack = (dataId: string) => {
      const image = app.getData(dataId)?.image;
      const vc = app.getViewLayersByDataId(dataId)?.[0]?.getViewController();
      if (!image || !vc) return false;

      const metaRoot = app.getMetaData(dataId);
      if (metaRoot) {
        setCurrentMetaData(metaRoot);
        const lengthCalibration = getLengthCalibration(metaRoot);
        setCalibration(lengthCalibration);
        custom.labelTexts = measurementLabelTexts(lengthCalibration);
      }
      const vals = vc.getCurrentIndex().getValues();
      const sliceCount = image.getGeometry().getSize().get(2);
      const _loadedSlicesMapping: typeof loadedSlicesMapping = {};
      for (let i = 0; i < sliceCount; i++) {
        const idxVals = [...vals];
        idxVals[2] = i;
        _loadedSlicesMapping[i] = image.getImageUid(new Index(idxVals));
      }
      setLoadedSlicesMapping(_loadedSlicesMapping);
      setSliceCount(sliceCount);
      if (shownDataIdRef.current === dataId) return true;

      shownDataIdRef.current = dataId;
      // dwv shows a new stack fitted.
      followsFitRef.current = true;
      setLoadStateError(null);
      const canScroll = vc.canScroll();
      if (vc.isMonochrome()) setCanWindowLevel(true);
      if (canScroll) setCanScroll(true);
      onChangeTool(canScroll ? 'Scroll' : 'ZoomAndPan');
      setCurrentImageId(_loadedSlicesMapping[sliceCount - 1]);
      setIsShowDropbox(sliceCount === 0);
      setIsDataLoaded(true);
      return true;
    };

    /**
     * After dwv's `loadend` (possibly too early) and after later changes:
     * shows the stack, or reports a failure once every input was accounted
     * for.
     */
    const settle = (dataId: string) => {
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, { dataid: dataId })) {
        return;
      }
      if (showStack(dataId)) return;
      // dwv's loadend came early: inputs may still be added.
      if (loadTrackerRef.current && !loadTrackerRef.current.summary().settled) return;
      // Never report a stack as loaded if it cannot be shown: Complete
      // Review requires a verified rendered stack.
      setLoadStateError('DICOM image stack could not be displayed. Reload this Series.');
      setIsDataLoaded(false);
      setIsLoadSuccessful(false);
      setSliceCount(0);
      setLoadedSlicesMapping({});
      setCurrentImageId(undefined);
      // Standalone: back to the imported Series list (Clean needs data).
      if (isCleanRef.current) setIsShowDropbox(true);
    };

    /**
     * Publishes what dwv reported since the last time, at once (one React
     * render), and once dwv's `loadend` came re-reads its stack. Reads the
     * refs when it runs: after Clean, a replacement or unmount there is
     * nothing (left) to publish, and it holds no dwv data itself.
     */
    const reconcile = () => {
      reconcileFrameRef.current = null;
      if (!isMountedRef.current) return;
      if (itemSourcesChangedRef.current) {
        itemSourcesChangedRef.current = false;
        setLoadedItemsMapping({ ...itemSourcesRef.current });
      }
      const errors = pendingErrorsRef.current;
      if (errors.length) {
        pendingErrorsRef.current = [];
        setLoadErrorEvents((state) => [...state, ...errors]);
      }
      if (loadTrackerRef.current) setLoadAccount(loadTrackerRef.current.summary());
      if (endedDataIdRef.current !== undefined) settle(endedDataIdRef.current);
    };
    /** At most one reconciliation per frame, however many events come. */
    const scheduleReconcile = () => {
      if (reconcileFrameRef.current === null) {
        reconcileFrameRef.current = requestFrame(reconcile);
      }
    };

    app.addEventListener('loadstart', (event: { dataid?: unknown }) => {
      if (event?.dataid === undefined) return;
      const dataId = `${event.dataid}`;
      activeDataIdRef.current = dataId;
      shownDataIdRef.current = undefined;
      endedDataIdRef.current = undefined;
      loadTrackerRef.current = createLoadTracker(dataId, loadInputsRef.current);
      setLoadAccount(loadTrackerRef.current.summary());
    });
    app.addEventListener('loadend', (event: DicomLoadEndEvent) => {
      // An in-flight load can finish while this viewer is being removed,
      // or after it was replaced by another Series.
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, event)) return;
      loadTrackerRef.current?.ended();
      endedDataIdRef.current = `${event.dataid}`;
      // The (first) stack is shown right away.
      cancelReconcile();
      reconcile();
    });
    // A slice is in the image only once dwv stored it (`loaditem` comes
    // before dwv tries to append it). Shown in the next frame: after dwv's
    // own handling (it stores the first slice, then renders it).
    const onDataChange = (event: { dataid?: unknown }) => {
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, event)) return;
      loadTrackerRef.current?.stored();
      scheduleReconcile();
    };
    app.addEventListener('dataadd', onDataChange);
    app.addEventListener('dataupdate', onDataChange);

    // dwv keeps reading the files it no longer tracks after an early
    // loadend (they cannot be aborted): their progress, with the old data
    // id, can come after Clean or a replacement.
    app.addEventListener('loadprogress', (event: DicomLoadProgressEvent) => {
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, event)) return;
      setLoadProgress(event.loaded);
    });
    app.addEventListener('load', (event: unknown) => {
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, event)) return;
      setIsLoadSuccessful(true);
    });
    app.addEventListener(
      'positionchange',
      (event: DicomPositionChangeEvent) => {
        // dwv also fires it without `data` (e.g. when a drawing starts):
        // throwing here would abort dwv's event dispatch (and the drawing).
        // It carries no data id; a removed stack's layers are unbound by dwv,
        // and between Clean (or a replacement) and the next load nothing is
        // shown.
        if (!isMountedRef.current || activeDataIdRef.current === REPLACED_LOAD) return;
        const imageUid = event.data?.imageUid;
        if (imageUid) setCurrentImageId(imageUid);
      }
    );
    // The file of each image UID (the item may still fail to be appended).
    app.addEventListener('loaditem', (event: DicomLoadItemEvent) => {
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, event)) return;
      loadTrackerRef.current?.item(event.source, storedSize(event.dataid));
      let name = '';
      if (typeof event.source === 'string') {
        name = event.source;
      } else {
        if (event.source instanceof File) {
          name = event.source.name;
        }
      }
      const uid = getImageUid(event.data);
      if (uid) {
        itemSourcesRef.current[uid] = name;
        itemSourcesChangedRef.current = true;
        scheduleReconcile();
      }
    });
    // dwv 0.35 fires load failures as `error` and `abort` (its App sets
    // these types; there are no `loaderror` / `loadabort` events). Each
    // failed input comes with its source; an error without one is dwv
    // giving up on the whole load (e.g. no loader for the files). An error
    // can also come after dwv stored the image (metadata merge).
    const onLoadFailure = (event: DicomLoadErrorEvent) => {
      if (!isMountedRef.current || isStaleLoadEvent(activeDataIdRef.current, event)) return;
      const tracker = loadTrackerRef.current;
      if (tracker && event.source === undefined) tracker.failedAll();
      else tracker?.failed(event.source, storedSize(event.dataid));
      // Kept only as presented: dwv's message can carry patient details.
      pendingErrorsRef.current.push(presentLoadError(event, loadInputsRef.current));
      scheduleReconcile();
    };
    app.addEventListener('error', onLoadFailure);
    app.addEventListener('abort', onLoadFailure);
    app.addEventListener('keydown', (event: KeyboardEvent) => {
      if (isMountedRef.current) app.defaultOnKeydown(event);
    });
    // Zoom or pan by a tool (or "Actual pixels"): kept on resize.
    const onViewChange = () => {
      followsFitRef.current = false;
    };
    app.addEventListener('zoomchange', onViewChange);
    app.addEventListener('offsetchange', onViewChange);
    // No `app.onResize` on window resizes: the viewport's resize (window
    // resizes included) refits through the layout above, which keeps the
    // user's zoom/pan.

    if (list?.length) {
      Promise.resolve(getRequestHeaders?.() ?? {}).then((headers) => {
        // Unmounted while the headers were being resolved.
        if (!isMountedRef.current) return;
        loadInputsRef.current = list;
        app.loadURLs(list, {
          requestHeaders: Object.entries(headers).map(([name, value]) => ({
            name,
            value,
          })),
        });
      });
    } else {
      setIsShowDropbox(true);
    }
    appRef.current = app;

    return () => {
      isMountedRef.current = false;
      // Requests still in flight belong to this viewer only (e.g. the
      // previous Series): stop them before the next viewer loads, and free
      // the decoded data.
      activeDataIdRef.current = REPLACED_LOAD;
      forgetLoad();
      releaseDwvData(app);
    };
  }, []);

  // Also when slices are appended after dwv's (early) loadend.
  useEffect(() => {
    if (isDataLoaded) {
      const _loadedItems = [];
      for (let i = 0; i < sliceCount; i++) {
        const imageUid = loadedSlicesMapping[i];
        _loadedItems.push({
          imageUid,
          source: loadedItemsMapping[imageUid],
          index: i,
        });
      }
      setItems(_loadedItems);
    }
  }, [isDataLoaded, sliceCount, loadedSlicesMapping, loadedItemsMapping]);

  useEffect(() => {
    if (
      onLoadResult &&
      (isDataLoaded || loadErrorEvents.length || loadStateError)
    ) {
      const loadedSources: string[] = [];
      if (isDataLoaded) {
        for (let i = 0; i < sliceCount; i++) {
          const source = loadedItemsMapping[loadedSlicesMapping[i]];
          if (source) loadedSources.push(source);
        }
      }
      onLoadResult({
        sliceCount: isDataLoaded ? sliceCount : 0,
        errorCount: loadErrorEvents.length + (loadStateError ? 1 : 0),
        metadataErrorCount: loadErrorEvents.filter((e) => e.category === 'metadata').length,
        loadedSources,
      });
    }
  }, [
    isDataLoaded,
    sliceCount,
    loadErrorEvents,
    loadStateError,
    loadedItemsMapping,
    loadedSlicesMapping,
    onLoadResult,
  ]);

  /** SOP Instance UID -> slice index in the loaded volume. */
  const sliceIndexByUid = useMemo(() => {
    const result = new Map<string, number>();
    for (let i = 0; i < sliceCount; i++) {
      const uid = loadedSlicesMapping[i];
      if (uid) result.set(uid, i);
    }
    return result;
  }, [loadedSlicesMapping, sliceCount]);

  // Also re-resolved when the mappings fill in (the slice on screen may be
  // reported before its item or the volume's slice order is known).
  useEffect(() => {
    if (currentImageId && onCurrentItemChange) {
      const currentSource = loadedItemsMapping[currentImageId];
      const index = sliceIndexByUid.get(currentImageId);
      onCurrentItemChange(
        currentSource,
        index === undefined ? undefined : { index, loadedCount: sliceCount }
      );
    }
  }, [currentImageId, loadedItemsMapping, sliceIndexByUid, sliceCount, onCurrentItemChange]);

  return (
    <Stack spacing={2}>
      {loadProgress !== 100 && loadProgress !== 0 && (
        <LinearProgress variant="determinate" value={loadProgress} />
      )}
      {loadStateError && <Alert severity="error">{loadStateError}</Alert>}
      {isClean && loadAccount && (isDataLoaded || loadStatus(loadAccount) === 'pending') && (
        <LocalLoadStatus summary={loadAccount} sliceCount={sliceCount} />
      )}
      {/*
        Custom panels sit on both sides of the toolbar and viewport (or below
        them) and are always rendered: they keep their state when the
        placement changes, and the viewport takes the width they leave (e.g.
        when one is collapsed; dwv refits in place on the resize). So does
        the default image list (standalone viewer). The toolbar is centred
        over the viewport only.
      */}
      <Stack
        data-testid="dicom-viewport-row"
        direction={panelsBeside ? 'row' : 'column'}
        spacing={panelsBeside ? 1 : 2}
        useFlexGap
      >
        {!!leadingPanel && (
          <Box
            data-testid="dicom-viewer-leading"
            sx={{ display: 'flex', flexShrink: 0, order: panelsBeside ? 0 : 3 }}
          >
            {leadingPanel}
          </Box>
        )}
        <Stack
          data-testid="dicom-viewer-main"
          spacing={2}
          sx={{ flex: panelsBeside ? 1 : undefined, minWidth: 0, order: 1 }}
        >
          <DicomViewerTools
            tools={VIEWER_TOOLS}
            selectedTool={selectedTool}
            onChangeTool={onChangeTool}
            onReset={onReset}
            onActualPixels={onActualPixels}
            canRunTool={canRunTool}
            isDataLoaded={isDataLoaded}
            metaData={currentMetaData}
            calibration={calibration}
            isLoadSuccessful={
              isDataLoaded &&
              isLoadSuccessful &&
              !loadStateError &&
              !loadErrorEvents.length
            }
            loadErrorEvents={loadErrorEvents}
            onClean={isClean ? onClean : undefined}
            // Also after a failed or stuck load: back to the import.
            canClean={isDataLoaded || !!loadStateError || loadErrorEvents.length > 0}
          />
          {toolbar}
          <Box
            ref={viewportRef}
            data-testid="dicom-viewport"
            sx={{
              position: 'relative',
              height: VIEWPORT_HEIGHT,
              width: '100%',
              minWidth: 0,
              overflow: 'hidden',
              bgcolor: 'common.black',
            }}
          >
            <div
              ref={containerRef}
              id="layerGroup0"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: layout?.width ?? '100%',
                height: layout?.height ?? '100%',
                transform: layout ? `scale(${layout.scale})` : undefined,
                transformOrigin: '0 0',
              }}
            />
            {/* Local files are only offered by the standalone viewer. */}
            <DicomViewerDropbox
              isShow={isShowDropbox && !!isClean}
              onLoadFiles={onLoadFiles}
            />
          </Box>
        </Stack>
        {!!renderSidebar && (
          <Box
            data-testid="dicom-viewer-sidebar"
            sx={{ display: 'flex', flexShrink: 0, order: 2 }}
          >
            {renderSidebar({ items, currentImageId, jumpTo })}
          </Box>
        )}
        {showImageList && (
          <Box
            data-testid="dicom-viewer-image-list"
            sx={{ display: 'flex', flexShrink: 0, order: 2 }}
          >
            <DicomViewerSidebar
              currentImageId={currentImageId}
              items={items}
              icon={sidebarItemIcon}
              onJumpTo={jumpTo}
              expanded={isImageListExpanded}
              onToggle={toggleImageList}
            />
          </Box>
        )}
      </Stack>
      <DicomViewerFooter />
    </Stack>
  );
};
