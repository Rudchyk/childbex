'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { App, Index } from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';
import { useDropbox } from './useDropbox';
import { DicomViewerSidebar } from './DicomViewerSidebar';

import './DicomViewer.css';
import {
  DicomLoadErrorEvent,
  DicomLoadErrorEvents,
  DicomLoadItemEvent,
  DicomLoadProgressEvent,
  DicomPositionChangeEvent,
  DicomLoadEndEvent,
} from './DicomViewer.types';

interface DwvComponentProps {
  images?: string[];
}

/**
 * Return the SOP Instance UID (image ID) for the given slice index.
 *
 * @param meta  one element of app.getMetaData(dataId)   (the JSON you pasted)
 * @param slice zero‑based index of the slice now on screen (0,1,2…)
 */
export function getImageUid(meta: any, slice = 0): string | undefined {
  const tag = meta['00080018']; // (0008,0018) SOP Instance UID
  if (!tag) {
    return;
  }

  const v = tag.value;
  // ─── Single‑slice object: value is just an array ──────────────────────────
  if (Array.isArray(v)) {
    return v[0];
  }

  // ─── Multi‑slice: keyed by "1", "2", … ────────────────────────────────────
  const key = String(slice + 1); // convert 0‑based → 1‑based
  const arr = (v as Record<string, any>)[key];
  return Array.isArray(arr) ? arr[0] : undefined;
}

export const DicomViewer: FC<DwvComponentProps> = ({ images = [] }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<App>(null);
  const tools = {
    Scroll: {},
    ZoomAndPan: {},
    WindowLevel: {},
    Draw: {
      // options: ['Ruler'],
      options: ['Rectangle'],
      type: 'factory',
    },
  };
  // const { showDropbox, setupDropbox } = useDropbox();
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
  const [items, setItems] = useState<Item[]>([]);
  const [sliceCount, setSliceCount] = useState<number>(0);
  const [loadErrorEvents, setLoadErrorEvents] = useState<DicomLoadErrorEvents>(
    []
  );
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoadSuccessful, setIsLoadSuccessful] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  const [selectedTool, setSelectedTool] = useState('Select Tool');
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

  useEffect(() => {
    if (appRef.current) {
      return;
    }

    const app = new App();
    app.init({
      dataViewConfigs: { '*': [{ divId: containerRef?.current?.id }] },
      tools,
    });

    /**
     * @event type DicomLoadStartEvent
     */
    app.addEventListener('loadstart', () => {
      // showDropbox(app, false);
    });
    app.addEventListener('loadprogress', (event: DicomLoadProgressEvent) => {
      setLoadProgress(event.loaded);
    });
    // app.addEventListener('renderend', (event: { dataid: number }) => {});
    app.addEventListener('load', () => {
      // console.log('load');
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
    });
    app.addEventListener(
      'positionchange',
      (event: DicomPositionChangeEvent) => {
        setCurrentImageId(event.data.imageUid);
        // console.table({
        //   patientName: meta['00100010']?.value?.[0], // (0020,0013) patientName
        //   instanceNumber: meta['00200013']?.value?.[0], // (0020,0013) InstanceNumber
        //   sliceLocation: meta['00201041']?.value?.[0], // (0020,1041)
        //   thickness: meta['00180050']?.value?.[0], // (0018,0050) SliceThickness
        //   windowCenter: meta['00281050']?.value?.[0], // (0028,1050)
        //   windowWidth: meta['00281051']?.value?.[0], // (0028,1051)
        //   sopClass: meta['00080016']?.value?.[0], // (0008,0016)
        //   uid: imageUid,
        // });
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

    if (images?.length) {
      app.loadURLs(images);
    }
    appRef.current = app;
    // setupDropbox(app);

    return () => appRef.current?.reset();
  }, []);

  // const getCurrentImage = (imageId?: string) => {
  //   if (!imageId) {
  //     return '';
  //   }
  //   return loadedItemsMapping[imageId] || '';
  // };

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
      />
      <Box
        ref={containerRef}
        id="layerGroup0"
        sx={{ height: 500, width: '100%' }}
      >
        <Box id="dropBox"></Box>
      </Box>
      <DicomViewerSidebar
        app={appRef.current}
        currentImageId={currentImageId}
        containerId={containerRef.current?.id}
        items={items}
      />
      {/* <Typography variant="caption" textAlign="center">
        Source: {getCurrentImage(currentImageId)}
      </Typography>
      <Typography variant="caption" textAlign="center">
        Image UID: {currentImageId}
      </Typography> */}
      <DicomViewerFooter />
    </Stack>
  );
};
