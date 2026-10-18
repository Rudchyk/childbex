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
  DicomLoadErrorEvents,
  DicomLoadItemEvent,
  DicomLoadProgressEvent,
  DicomPositionChangeEvent,
  DicomLoadEndEvent,
} from './DicomViewer.types';

import './DicomViewer.css';
import { getImageUid } from './DicomViewer.utils';
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
  /** Load errors so far. */
  errorCount: number;
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
  const [loadErrorEvents, setLoadErrorEvents] = useState<DicomLoadErrorEvents>(
    []
  );
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
  /** Custom panels next to the viewport (without any: full width). */
  const panelsBeside =
    (!!renderSidebar || !!leadingPanel) && sidebarPlacement === 'beside';

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
  const onLoadFiles = (files: File[]) => {
    if (appRef.current) {
      appRef.current.loadFiles(files);
    }
  };
  const onClean = () => {
    appRef.current?.reset();
    setItems([]);
    setSliceCount(0);
    setLoadProgress(0);
    setIsLoadSuccessful(false);
    setIsShowDropbox(true);
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
  // Stable: memoised slice rows receive it.
  const jumpTo = useCallback((i: number) => {
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

  // dwv reads the container size when it fits: refit after a change.
  useEffect(() => {
    if (layout && isDataLoaded) appRef.current?.fitToContainer();
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

    app.addEventListener('loadend', (event: DicomLoadEndEvent) => {
      // An in-flight load can finish while this viewer is being removed.
      if (!isMountedRef.current) return;

      const image = app.getData(event.dataid)?.image;
      const viewLayer = app.getViewLayersByDataId(event.dataid)?.[0];
      const vc = viewLayer?.getViewController();

      // DWV can emit loadend after an aborted/failed load, before any view
      // layer exists. Never report a stack as loaded if it cannot be shown:
      // Complete Review requires a verified rendered stack.
      if (!image || !vc) {
        setLoadStateError(
          'DICOM image stack could not be displayed. Reload this Series.'
        );
        setIsDataLoaded(false);
        setIsLoadSuccessful(false);
        setSliceCount(0);
        setLoadedSlicesMapping({});
        setCurrentImageId(undefined);
        return;
      }

      setLoadStateError(null);
      const metaRoot = app.getMetaData(event.dataid);
      if (metaRoot) {
        setCurrentMetaData(metaRoot);
        const lengthCalibration = getLengthCalibration(metaRoot);
        setCalibration(lengthCalibration);
        custom.labelTexts = measurementLabelTexts(lengthCalibration);
      }

      const canScroll = vc.canScroll();
      const canMonochrome = vc.isMonochrome();
      if (canMonochrome) {
        setCanWindowLevel(true);
      }
      if (canScroll) {
        setCanScroll(true);
      }
      onChangeTool(canScroll ? 'Scroll' : 'ZoomAndPan');
      const vals = vc.getCurrentIndex().getValues();
      const geometry = image.getGeometry();
      const size = geometry.getSize();
      const sliceCount = size.get(2);
      const _loadedSlicesMapping: typeof loadedSlicesMapping = {};
      for (let i = 0; i < sliceCount; i++) {
        const idxVals = [...vals];
        idxVals[2] = i;
        const index = new Index(idxVals);
        const uid = image.getImageUid(index);
        _loadedSlicesMapping[i] = uid;
      }
      setLoadedSlicesMapping(_loadedSlicesMapping);
      setCurrentImageId(_loadedSlicesMapping[sliceCount - 1]);
      setSliceCount(sliceCount);
      setIsShowDropbox(sliceCount === 0);

      setIsDataLoaded(true);
    });

    app.addEventListener('loadprogress', (event: DicomLoadProgressEvent) => {
      if (isMountedRef.current) setLoadProgress(event.loaded);
    });
    app.addEventListener('load', () => {
      if (isMountedRef.current) setIsLoadSuccessful(true);
    });
    app.addEventListener(
      'positionchange',
      (event: DicomPositionChangeEvent) => {
        // dwv also fires it without `data` (e.g. when a drawing starts):
        // throwing here would abort dwv's event dispatch (and the drawing).
        if (!isMountedRef.current) return;
        const imageUid = event.data?.imageUid;
        if (imageUid) setCurrentImageId(imageUid);
      }
    );
    app.addEventListener('loaditem', (event: DicomLoadItemEvent) => {
      if (!isMountedRef.current) return;
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
        setLoadedItemsMapping((state) => ({ ...state, [uid]: name }));
      }
    });
    app.addEventListener('loaderror', (event: DicomLoadErrorEvent) => {
      if (!isMountedRef.current) return;
      setLoadErrorEvents((state) => [...state, event]);
    });
    app.addEventListener('loadabort', (event: DicomLoadErrorEvent) => {
      if (!isMountedRef.current) return;
      setLoadErrorEvents((state) => [...state, event]);
    });
    app.addEventListener('keydown', (event: KeyboardEvent) => {
      if (isMountedRef.current) app.defaultOnKeydown(event);
    });

    window.addEventListener('resize', app.onResize);

    if (list?.length) {
      Promise.resolve(getRequestHeaders?.() ?? {}).then((headers) => {
        // Unmounted while the headers were being resolved.
        if (!isMountedRef.current) return;
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
      window.removeEventListener('resize', app.onResize);
      // Requests still in flight belong to this viewer only (e.g. the
      // previous Series): stop them before the next viewer loads.
      app.abortAllLoads();
      appRef.current?.reset();
    };
  }, []);

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
  }, [isDataLoaded]);

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
        loadedSources,
      });
    }
  }, [
    isDataLoaded,
    sliceCount,
    loadErrorEvents.length,
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
      {/*
        Custom panels sit on both sides of the toolbar and viewport (or below
        them) and are always rendered: they keep their state when the
        placement changes, and the viewport takes the width they leave (e.g.
        when one is collapsed; dwv refits in place on the resize). The
        toolbar is centred over the viewport only.
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
            <DicomViewerDropbox isShow={isShowDropbox} onLoadFiles={onLoadFiles} />
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
      </Stack>
      {!matches && !renderSidebar && (
        <DicomViewerSidebar
          currentImageId={currentImageId}
          items={items}
          icon={sidebarItemIcon}
          onJumpTo={jumpTo}
        />
      )}
      <DicomViewerFooter />
    </Stack>
  );
};
