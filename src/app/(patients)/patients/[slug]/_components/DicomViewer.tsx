'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Stack } from '@mui/material';
import { App } from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';

import './DicomViewer.css';

interface DwvComponentProps {
  images?: string[];
}

export const DicomViewer: FC<DwvComponentProps> = ({ images = [] }) => {
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
  const [nLoadItem, setNLoadItem] = useState(0);
  const [nReceivedLoadError, setNReceivedLoadError] = useState(0);
  const [nReceivedLoadAbort, setNReceivedLoadAbort] = useState(0);
  const [loadProgress, setLoadProgress] = useState(0);
  const [canScroll, setCanScroll] = useState(false);
  const [selectedTool, setSelectedTool] = useState('Select Tool');
  const [canWindowLevel, setCanWindowLevel] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [metaData, setMetaData] = useState({});
  const onChangeShape = (shape: string) => {
    if (appRef.current) {
      appRef.current.setToolFeatures({ shapeName: shape });
    }
  };
  const onChangeTool = (tool: string) => {
    console.log('🚀 ~ onChangeTool ~ tool:', tool);
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
      dataViewConfigs: { '*': [{ divId: 'layerGroup0' }] },
      tools,
    });
    let isFirstRender: boolean;

    app.addEventListener('loadstart', () => {
      setNLoadItem(0);
      setNReceivedLoadError(0);
      setNReceivedLoadAbort(0);
      isFirstRender = true;
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

      console.log('dataid', event);
    });
    app.addEventListener('load', () => {
      setDataLoaded(true);
    });
    app.addEventListener('loadend', () => {
      if (nReceivedLoadError) {
        setLoadProgress(0);
        alert('Received errors during load. Check log for details.');
      }
      if (nReceivedLoadAbort) {
        setLoadProgress(0);
        alert('Load was aborted.');
      }
    });
    app.addEventListener('loaditem', () => {
      setNLoadItem((state) => ++state);
    });
    app.addEventListener('loaderror', (event: { error: Error }) => {
      console.error(event.error);
      setNReceivedLoadError((state) => ++state);
    });
    app.addEventListener('loadabort', () => {
      setNReceivedLoadAbort((state) => ++state);
    });
    app.addEventListener('keydown', (event: KeyboardEvent) => {
      app.defaultOnKeydown(event);
    });
    window.addEventListener('resize', app.onResize);

    app.loadURLs(images);
    appRef.current = app;

    return () => appRef.current?.reset();
  }, []);

  return (
    <Box>
      {loadProgress !== 100 && (
        <LinearProgress variant="determinate" value={loadProgress} />
      )}
      <DicomViewerTools
        tools={tools}
        selectedTool={selectedTool}
        onChangeTool={onChangeTool}
        onReset={onReset}
        canRunTool={canRunTool}
        dataLoaded={dataLoaded}
        metaData={metaData}
      />
      <Stack spacing={2}>
        <div
          id="layerGroup0"
          style={{ height: 500, width: '100%', border: '1px dashed #ccc' }}
        />
        <DicomViewerFooter />
      </Stack>
    </Box>
  );
};
