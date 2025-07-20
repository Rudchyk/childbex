'use client';

import {
  FC,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Box, LinearProgress, Stack } from '@mui/material';
import { App, Index } from 'dwv';
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
} from './DicomViewer.types';

import './DicomViewer.css';
import { getImageUid } from './DicomViewer.utils';
import { DicomViewerDropbox } from './DicomViewerDropbox';

interface DicomViewerProps {
  list?: string[];
  isClean?: boolean;
  onCurrentItemChange?: (source: string) => void;
  toolbar?: ReactElement | ReactNode;
  sidebarItemIcon?: (source: string) => ReactElement;
}

export const DicomViewer: FC<DicomViewerProps> = ({
  list = [],
  isClean,
  onCurrentItemChange,
  toolbar,
  sidebarItemIcon,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<App>(null);
  const tools = {
    Scroll: {},
    ZoomAndPan: {},
    WindowLevel: {},
    Draw: {
      options: ['Rectangle'],
      type: 'factory',
    },
  };
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
    Record<string, unknown>
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
          onChangeShape(tools.Draw.options[0]);
          break;
        default:
          const lg = appRef.current.getActiveLayerGroup();
          lg.setActiveViewLayer(0);
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
      appRef.current.resetLayout();
    }
  };
  const onLoadFiles = (files: FileList) => {
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
  };

  useEffect(() => {
    if (appRef.current) {
      return;
    }

    const app = new App();
    app.init({
      dataViewConfigs: { '*': [{ divId: containerRef?.current?.id }] },
      tools,
    });

    app.addEventListener('loadprogress', (event: DicomLoadProgressEvent) => {
      setLoadProgress(event.loaded);
    });
    app.addEventListener('load', () => {
      setIsLoadSuccessful(true);
    });
    app.addEventListener('loadend', (event: DicomLoadEndEvent) => {
      const vl = app.getViewLayersByDataIndex(event.loadid);
      const vlItem = vl[0];
      const vc = vlItem.getViewController();
      const canScroll = vc.canScroll();
      const canWindowLevel = vc.canWindowLevel();
      const image = app.getImage(event.loadid);
      const geometry = image.getGeometry();
      const size = geometry.getSize();
      const sliceCount = size.get(2);
      const vals = vc.getCurrentIndex().getValues();
      const metaRoot = app.getMetaData(event.loadid) as typeof currentMetaData;
      const _loadedSlicesMapping: typeof loadedSlicesMapping = {};
      for (let i = 0; i < sliceCount; i++) {
        const vals2 = [...vals];
        vals2[2] = i;
        const intdex = new Index(vals2);
        const currentImageUid = image.getImageUid(intdex);
        _loadedSlicesMapping[i] = currentImageUid;
      }
      if (canWindowLevel) {
        setCanWindowLevel(true);
      }
      if (canScroll) {
        setCanScroll(true);
      }
      onChangeTool(canScroll ? 'Scroll' : 'ZoomAndPan');
      setSliceCount(sliceCount);
      setLoadedSlicesMapping(_loadedSlicesMapping);
      setCurrentImageId(_loadedSlicesMapping[sliceCount - 1]);
      setIsDataLoaded(true);
      setCurrentMetaData(metaRoot);
      setIsShowDropbox(sliceCount === 0);
    });
    app.addEventListener(
      'positionchange',
      (event: DicomPositionChangeEvent) => {
        setCurrentImageId(event.data.imageUid);
      }
    );
    app.addEventListener('loaditem', (event: DicomLoadItemEvent) => {
      let name = '';
      if (typeof event.source === 'string') {
        name = event.source;
      } else {
        if (event.source instanceof File) {
          name = event.source.name;
        }
      }
      const uid = getImageUid(event.data, 0);
      if (uid) {
        setLoadedItemsMapping((state) => ({ ...state, [uid]: name }));
      }
    });
    app.addEventListener('loaderror', (event: DicomLoadErrorEvent) => {
      setLoadErrorEvents((state) => [...state, event]);
    });
    app.addEventListener('loadabort', (event: DicomLoadErrorEvent) => {
      setLoadErrorEvents((state) => [...state, event]);
    });
    app.addEventListener('keydown', (event: KeyboardEvent) => {
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
