'use client';

import { FC, useEffect, useRef, useState } from 'react';
import {
  Box,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { App } from 'dwv';
import { DicomViewerFooter } from './DicomViewerFooter';
import { DicomViewerTools } from './DicomViewerTools';
import { useDropbox } from './useDropbox';

import './DicomViewer.css';
import {
  DicomLoadErrorEvent,
  DicomLoadErrorEvents,
  DicomLoadItemEvent,
  DicomLoadProgressEvent,
  DicomLoadStartEvent,
  DicomPositionChangeEvent,
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
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
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
  const [imagesSourcesMapping, setImagesSourcesMapping] = useState<
    Record<string, string>
  >({});
  const [loadedItems, setLoadedItems] = useState<string[]>([]);
  const [loadErrorEvents, setLoadErrorEvents] = useState<DicomLoadErrorEvents>(
    []
  );
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoadSuccessful, setIsLoadSuccessful] = useState(false);
  const [canScroll, setCanScroll] = useState(false);
  const [selectedTool, setSelectedTool] = useState('Select Tool');
  const [canWindowLevel, setCanWindowLevel] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [metaData, setMetaData] = useState<Record<string, unknown>>({});
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
    let isFirstRender: boolean;

    /**
     * @event type DicomLoadStartEvent
     */
    app.addEventListener('loadstart', () => {
      console.log('loadstart');
      isFirstRender = true;
      showDropbox(app, false);
    });
    app.addEventListener('loadprogress', (event: DicomLoadProgressEvent) => {
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
      // console.log('load');
      setIsLoadSuccessful(true);
    });
    app.addEventListener('loadend', (event: any) => {
      // console.log('loadend', event);
      setIsDataLoaded(true);
    });
    app.addEventListener(
      'positionchange',
      (event: DicomPositionChangeEvent) => {
        setCurrentImageId(event.data.imageUid);
        const dataId = event.dataid; // the dataset key DWV created
        const metaRoot = app.getMetaData(dataId) as object;
        console.log('metaRoot', metaRoot);
        setMetaData(metaRoot);
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
      // console.log('loaditem', event);
      let name = '';
      if (typeof event.source === 'string') {
        name = event.source;
      } else {
        if ((event.source as any).name) {
          name = (event.source as any).name;
        }
      }
      const uid = getImageUid(event.data, 0);
      if (uid) {
        setImagesSourcesMapping((state) => ({ ...state, [uid]: name }));
      }
      setLoadedItems((state) => [...state, name]);
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
    setupDropbox(app);

    return () => appRef.current?.reset();
  }, []);

  const getCurrentImageSource = (imageId?: string) => {
    if (!imageId) {
      return '';
    }
    return imagesSourcesMapping[imageId] || '';
  };
  const getIsCurrentImageSourceExists = (source: string, imageId = '') => {
    return imagesSourcesMapping[imageId] === source;
  };

  useEffect(() => {
    if (isDataLoaded && appRef.current) {
      if (!loadedItems.length) {
        console.log('loadedItems', loadedItems.length);

        showDropbox(appRef.current, true);
      } else {
        // const image = appRef.current.getImage(0);
        // const uid = image.getImageUid();
        // setCurrentImageId(uid);
      }
    }
  }, [isDataLoaded]);

  //   useLayoutEffect(() => {
  //   const el = itemRefs.current[initialHoveredIndex];
  //   if (!el) return;

  //   /* 3️⃣ Scroll the *list*, not the whole window */
  //   el.scrollIntoView({
  //     behavior: 'smooth',   // skip this if you need an instant jump
  //     block: 'center',      // start | center | end | nearest
  //     inline: 'nearest'
  //   });
  // }, [initialHoveredIndex]);

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
        metaData={metaData}
        isLoadSuccessful={isLoadSuccessful}
        loadErrorEvents={loadErrorEvents}
      />
      <Typography variant="caption" textAlign="center">
        Image source: {getCurrentImageSource(currentImageId)}
      </Typography>
      <Box
        ref={containerRef}
        id="layerGroup0"
        sx={{ height: 500, width: '100%' }}
      >
        <Box id="dropBox"></Box>
      </Box>
      <Box
        component={Paper}
        elevation={3}
        sx={{
          position: 'fixed',
          top: '10%',
          bottom: '10%',
          right: 5,
          width: 300,
        }}
      >
        <List sx={{ height: '100%', overflow: 'auto' }}>
          <ListSubheader>Sources:</ListSubheader>
          {loadedItems.sort().map((source, i) => (
            <ListItem
              key={source}
              // ref={(el: any) => (itemRefs.current[i] = el)}
              sx={{
                borderBottom: '1px solid #ccc',
                background: (theme) =>
                  getIsCurrentImageSourceExists(source, currentImageId)
                    ? theme.palette.action.focus
                    : undefined,
              }}
            >
              <ListItemText primary={source} />
            </ListItem>
          ))}
        </List>
      </Box>
      <DicomViewerFooter />
    </Stack>
  );
};
