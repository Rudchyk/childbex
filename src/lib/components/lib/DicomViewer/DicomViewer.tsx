'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { App } from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';
import { useDropbox } from './useDropbox';

import './DicomViewer.css';
import {
  DicomLoadErrorEvent,
  DicomLoadErrorEvents,
  DicomLoadItemEvent,
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
  if (!tag) return;

  const v = tag.value;
  // ─── Single‑slice object: value is just an array ──────────────────────────
  if (Array.isArray(v)) return v[0];

  // ─── Multi‑slice: keyed by "1", "2", … ────────────────────────────────────
  const key = String(slice + 1); // convert 0‑based → 1‑based
  const arr = (v as Record<string, any>)[key];
  return Array.isArray(arr) ? arr[0] : undefined;
}

export const DicomViewer: FC<DwvComponentProps> = ({ images = [] }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<App | null>(null);
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
  const { showDropbox, setupDropbox } = useDropbox();
  const [imagesMapping, setImagesMapping] = useState<
    Record<string, string> | undefined
  >();
  const [loadedItems, setLoadedItems] = useState<string[]>([]);
  const [loadErrorEvents, setLoadErrorEvents] = useState<DicomLoadErrorEvents>(
    []
  );
  const [loadProgress, setLoadProgress] = useState(0);
  const [canScroll, setCanScroll] = useState(false);
  const [selectedTool, setSelectedTool] = useState('Select Tool');
  const [canWindowLevel, setCanWindowLevel] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [imageName, setImageName] = useState<string>();
  const [metaData, setMetaData] = useState<object | undefined>();
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
    let isFirstRender: boolean;

    app.addEventListener('loadstart', () => {
      isFirstRender = true;
      showDropbox(app, false);
    });
    app.addEventListener('loadprogress', (event: { loaded: number }) => {
      setLoadProgress(event.loaded);
    });
    app.addEventListener('renderend', (event: { dataid: number }) => {
      if (isFirstRender) {
        isFirstRender = false;
        const vl = app.getViewLayersByDataIndex(event.dataid);
        const vlItem = vl[0];
        const vc = vlItem.getViewController();
        const canScroll = vc.canScroll();
        if (canScroll) {
          setCanScroll(true);
        }
        const canWindowLevel = vc.canWindowLevel();
        if (canWindowLevel) {
          setCanWindowLevel(true);
        }
        onChangeTool(canScroll ? 'Scroll' : 'ZoomAndPan');
      }
    });
    app.addEventListener('load', () => {
      console.log('load');
    });
    app.addEventListener('loadend', () => {
      setDataLoaded(true);
    });
    app.addEventListener(
      'positionchange',
      (event: { dataid: number; data: { imageUid: string } }) => {
        // console.log('🚀 ~ app.addEventListener ~ event:', event);
        // const imageUid = event.data.imageUid; // SOPInstanceUID of that slice :contentReference[oaicite:0]{index=0}
        // console.log('imageUid', imageUid);
        // const dataId = event.dataid; // the dataset key DWV created
        // const metaRoot = app.getMetaData(dataId) as object;
        // console.log('metaRoot', metaRoot);
        // setMetaData(metaRoot);
        // console.log('imagesMapping', imagesMapping);
        // const currentUid = imagesMapping?.[imageUid];
        // setImageName(currentUid);
        // c// whole data set meta :contentReference[oaicite:1]{index=1}
        // const meta = metaRoot[imageUid] ?? metaRoot; // per‑instance sub‑tree
        // console.log('🚀 ~ app.addEventListener ~ meta:', meta);
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
      const uid = getImageUid(event.data, 0);
      if (uid) {
        setImagesMapping((state) => ({ ...state, [uid]: event.source }));
      }
      setLoadedItems((state) => [...state, event.source]);
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

    app.loadURLs(images);
    appRef.current = app;
    setupDropbox(app);

    return () => appRef.current?.reset();
  }, []);

  useEffect(() => {
    setImageName(loadedItems[0]);
    if (dataLoaded && !loadedItems.length && appRef.current) {
      showDropbox(appRef.current, true);
    }
  }, [dataLoaded]);

  return (
    <Stack spacing={2}>
      {loadProgress !== 100 && loadProgress !== 0 && (
        <LinearProgress variant="determinate" value={loadProgress} />
      )}
      <p>images: {images.length}</p>
      <pre>{images.join('\n')}</pre>
      <p>loadedItems: {loadedItems.length}</p>
      <p>loadErrorEvents: {loadErrorEvents.length}</p>
      <p>dataLoaded: {String(dataLoaded)}</p>
      <p>selectedTool: {selectedTool}</p>
      <Typography variant="h3">{imageName}</Typography>
      <DicomViewerTools
        app={appRef.current as any}
        tools={tools}
        selectedTool={selectedTool}
        onChangeTool={onChangeTool}
        onReset={onReset}
        canRunTool={canRunTool}
        dataLoaded={dataLoaded}
        metaData={metaData}
        loadErrorEvents={loadErrorEvents}
      />
      <Box
        ref={containerRef}
        id="layerGroup0"
        sx={{ height: 500, width: '100%' }}
      />
      <DicomViewerFooter />
    </Stack>
  );
};
