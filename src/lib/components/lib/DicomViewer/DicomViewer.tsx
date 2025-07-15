'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Stack, Typography } from '@mui/material';
import { App } from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';
import { useDropbox } from './useDropbox';

import './DicomViewer.css';

interface DwvComponentProps {
  images?: string[];
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
  const [erroredItems, setErroredItems] = useState<string[]>([]);
  const [abortedItems, setAbortedItems] = useState<string[]>([]);
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
    const _loadedItems: any[] = [];
    const _erroredItems: string[] = [];
    const _abortedItems: string[] = [];
    // const _imagesMapping: Record<string, string> = {};

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
      const metaRoot = app.getMetaData(0);
      console.log('loadend metaRoot', metaRoot);
      setMetaData(metaRoot);
      // const lg = app.getActiveLayerGroup(); // or app.getLayerGroup(0)
      // const vl = lg.getActiveViewLayer();
      // const vc = vl.getViewController();
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore
      // const currentUid = vc.getCurrentImageUid();
      // setImageName(currentUid);
      if (!_loadedItems.length) {
        showDropbox(app, true);
      }
    });
    app.addEventListener(
      'positionchange',
      (event: { dataid: number; data: { imageUid: string } }) => {
        console.log('🚀 ~ app.addEventListener ~ event:', event);
        const imageUid = event.data.imageUid; // SOPInstanceUID of that slice :contentReference[oaicite:0]{index=0}
        console.log('imageUid', imageUid);
        const dataId = event.dataid; // the dataset key DWV created
        const metaRoot = app.getMetaData(dataId) as object;
        console.log('metaRoot', metaRoot);

        setMetaData(metaRoot);
        console.log('imagesMapping', imagesMapping);

        const currentUid = imagesMapping?.[imageUid];
        setImageName(currentUid);
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
    app.addEventListener(
      'loaditem',
      (event: {
        source: string | File;
        imageUid: string;
        data: { imageUid: string };
      }) => {
        // console.log('loaditem', event);
        const uid = event.imageUid ?? event.data.imageUid;
        const src = event.source;
        const name =
          src instanceof File
            ? src.name
            : typeof src === 'string'
            ? src.split('/').pop()!
            : '(unknown)';
        _loadedItems.push(event.source);
        // _imagesMapping[uid] = name;
        console.log('name', uid, name);

        setImagesMapping({ ...imagesMapping, [uid]: name });
      }
    );
    app.addEventListener(
      'loaderror',
      (event: { error: Error; source: string }) => {
        _erroredItems.push(event.source);
      }
    );
    app.addEventListener(
      'loadabort',
      (event: { error: Error; source: string }) => {
        _abortedItems.push(event.source);
      }
    );
    app.addEventListener('keydown', (event: KeyboardEvent) => {
      app.defaultOnKeydown(event);
    });

    window.addEventListener('resize', app.onResize);

    // if (images.length)
    app.loadURLs(images);
    appRef.current = app;
    setupDropbox(app);
    setAbortedItems(_abortedItems);
    setErroredItems(_erroredItems);
    // setImagesMapping(_imagesMapping);
    // setLoadedItems(_loadedItems);

    return () => appRef.current?.reset();
  }, []);

  return (
    <Box>
      {loadProgress !== 100 && loadProgress !== 0 && (
        <LinearProgress variant="determinate" value={loadProgress} />
      )}
      <Typography variant="h3">{imageName}</Typography>
      <DicomViewerTools
        tools={tools}
        selectedTool={selectedTool}
        onChangeTool={onChangeTool}
        onReset={onReset}
        canRunTool={canRunTool}
        dataLoaded={dataLoaded}
        metaData={metaData}
        erroredItems={erroredItems}
        abortedItems={abortedItems}
      />
      <Stack spacing={2}>
        <Box
          ref={containerRef}
          id="layerGroup0"
          sx={{ height: 500, width: '100%' }}
        />
        <DicomViewerFooter />
      </Stack>
    </Box>
  );
};
