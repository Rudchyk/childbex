import {
  FC,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Box, LinearProgress, Stack } from '@mui/material';
import { App, AppOptions, DataElement, Index, ViewConfig } from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';
import { DicomViewerSidebar } from './DicomViewerSidebar';
import {
  DicomLoadErrorEvent,
  DicomLoadErrorEvents,
  DicomLoadItemEvent,
  DicomLoadProgressEvent,
  DicomPositionChangeEvent,
  DicomLoadEndEvent,
  DicomLoadEvent,
  DicomRenderendEvent,
  DicomLoadStartEvent,
} from './DicomViewer.types';

import './DicomViewer.css';
import { getImageUid, getSeriesDescription } from './DicomViewer.utils';
import { DicomViewerDropbox } from './DicomViewerDropbox';

interface DicomViewerProps {
  list?: string[];
  isClean?: boolean;
  onCurrentItemChange?: (source: string) => void;
  toolbar?: ReactElement | ReactNode;
  sidebarItemIcon?: (source: string) => ReactElement;
}

/**
 * https://ivmartel.github.io/dwv/
 * https://github.com/ivmartel/dwv
 * https://github.com/ivmartel/dwv-react
 * TODO: create grouping by seriesDescription for files
 */

export const DicomViewer: FC<DicomViewerProps> = ({
  list = [],
  isClean,
  onCurrentItemChange,
  toolbar,
  sidebarItemIcon,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<App>(null);
  const [loadedItemsMapping, setLoadedItemsMapping] = useState<
    Record<string, string>
  >({});
  const [loadedSlicesMapping, setLoadedSlicesMapping] = useState<
    Record<string, string>
  >({});
  interface Item {
    imageUid: string;
    source: string;
    index: number;
  }
  const tools: AppOptions['tools'] = {
    Scroll: {
      options: undefined,
    },
    WindowLevel: {
      options: undefined,
    },
    ZoomAndPan: {
      options: undefined,
    },
    Draw: {
      options: ['Rectangle'],
    },
  };
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
  const [currentMetaData, setCurrentMetaData] = useState<
    Record<string, DataElement>
  >({});
  const [currentImageId, setCurrentImageId] = useState<string | undefined>();
  const onChangeShape = (shape: string) => {
    if (appRef.current) {
      appRef.current.setToolFeatures({ shapeName: shape });
    }
  };
  const onChangeTool = (tool: string) => {
    if (appRef.current) {
      setSelectedTool(tool);
      appRef.current.setTool(tool);
      switch (tool) {
        case 'Draw':
          if (tools['Draw']?.options) {
            onChangeShape(tools.Draw.options[0]);
          }
          break;
        default:
          // eslint-disable-next-line no-case-declarations
          const lg = appRef.current.getActiveLayerGroup();
          if (lg) {
            lg.setActiveLayer(0);
          }
          break;
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
  const onReset = () => {
    if (appRef.current) {
      appRef.current.resetZoomPan();
    }
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
    setIsDataLoaded(false);
    setCanWindowLevel(false);
    setSelectedTool(defaultSelectedTool);
    setCanScroll(false);
    setLoadedSlicesMapping({});
    setLoadedItemsMapping({});
    setLoadErrorEvents([]);
  };

  useEffect(() => {
    if (appRef.current) {
      return;
    }

    const app = new App();
    const viewConfig0 = new ViewConfig(containerRef?.current?.id ?? '');
    const viewConfigs = { '*': [viewConfig0] };
    const options = new AppOptions(viewConfigs);
    options.tools = tools;
    app.init(options);
    // app.addEventListener('loadstart', (event: DicomLoadStartEvent) => {
    //   console.log('loadstart', event);
    // });
    // app.addEventListener('renderend', (event: DicomRenderendEvent) => {
    //   console.log('renderend', event);
    // });
    app.addEventListener('loadend', (event: DicomLoadEndEvent) => {
      // console.log('loadend', event);
      const metaRoot = app.getMetaData(event.dataid);
      if (metaRoot) {
        setCurrentMetaData(metaRoot);
      }
      const data = app.getData(event.dataid);
      const image = data?.image;
      const vls = app.getViewLayersByDataId(event.dataid);
      const vl = vls[0];
      const vc = vl.getViewController();
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
      if (image) {
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
      }

      setIsDataLoaded(true);
    });

    app.addEventListener('loadprogress', (event: DicomLoadProgressEvent) => {
      // console.log('loadprogress', event);
      setLoadProgress(event.loaded);
    });
    app.addEventListener('load', (event: DicomLoadEvent) => {
      // console.log('load', event);
      setIsLoadSuccessful(true);
    });
    app.addEventListener(
      'positionchange',
      (event: DicomPositionChangeEvent) => {
        // console.log('positionchange', event);
        setCurrentImageId(event.data.imageUid);
      }
    );
    app.addEventListener('loaditem', (event: DicomLoadItemEvent) => {
      // console.log('loaditem', event);
      let name = '';
      if (typeof event.source === 'string') {
        name = event.source;
      } else {
        if (event.source instanceof File) {
          name = event.source.name;
        }
      }
      app.setActiveLayerGroup(1);
      const uid = getImageUid(event.data);
      // const seriesDescription = getSeriesDescription(event.data);
      // console.log('🚀 ~ DicomViewer ~ seriesDescription:', seriesDescription);
      if (uid) {
        setLoadedItemsMapping((state) => ({ ...state, [uid]: name }));
      }
    });
    app.addEventListener('loaderror', (event: DicomLoadErrorEvent) => {
      // console.log('loaderror', event);
      setLoadErrorEvents((state) => [...state, event]);
    });
    app.addEventListener('loadabort', (event: DicomLoadErrorEvent) => {
      // console.log('loadabort', event);
      setLoadErrorEvents((state) => [...state, event]);
    });
    app.addEventListener('keydown', (event: KeyboardEvent) => {
      // console.log('keydown', event);
      app.defaultOnKeydown(event);
    });

    window.addEventListener('resize', app.onResize);

    if (list?.length) {
      app.loadURLs(list);
    } else {
      setIsShowDropbox(true);
    }
    appRef.current = app;

    return () => appRef.current?.reset();
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
    if (currentImageId && onCurrentItemChange) {
      const currentSource = loadedItemsMapping[currentImageId];
      onCurrentItemChange(currentSource);
    }
  }, [currentImageId]);

  return (
    <Stack spacing={2}>
      {loadProgress !== 100 && loadProgress !== 0 && (
        <LinearProgress variant="determinate" value={loadProgress} />
      )}
      <DicomViewerTools
        tools={tools}
        selectedTool={selectedTool}
        onChangeTool={onChangeTool}
        onReset={onReset}
        canRunTool={canRunTool}
        isDataLoaded={isDataLoaded}
        metaData={currentMetaData}
        isLoadSuccessful={isLoadSuccessful}
        loadErrorEvents={loadErrorEvents}
        onClean={isClean ? onClean : undefined}
      />
      {toolbar}
      <Box
        ref={containerRef}
        id="layerGroup0"
        sx={{ height: 500, width: '100%' }}
      >
        <DicomViewerDropbox isShow={isShowDropbox} onLoadFiles={onLoadFiles} />
      </Box>
      <DicomViewerSidebar
        app={appRef.current}
        currentImageId={currentImageId}
        items={items}
        icon={sidebarItemIcon}
      />
      <DicomViewerFooter />
    </Stack>
  );
};
