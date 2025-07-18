'use client';

import { FC, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Paper,
} from '@mui/material';
import { App, Index } from 'dwv';

export interface Item {
  imageUid: string;
  source: string;
  index: number;
}

export interface DicomViewerSidebarProps {
  items: Item[];
  currentImageId?: string;
  containerId?: string;
  app: App | null;
}

export const DicomViewerSidebar: FC<DicomViewerSidebarProps> = ({
  items = [],
  currentImageId,
  containerId,
  app,
}) => {
  const itemsList = useMemo(() => [...items].reverse(), [items]);
  const itemRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useLayoutEffect(() => {
    if (currentImageId) {
      const el = itemRefs.current[currentImageId];

      if (!el) {
        return;
      }

      el.scrollIntoView({
        behavior: 'smooth', // skip this if you need an instant jump
        block: 'center', // start | center | end | nearest
        inline: 'nearest',
      });
    }
  }, [currentImageId]);

  if (!containerId) {
    console.warn('containerId does not exist!');
    return null;
  }
  if (!app) {
    console.warn('app does not exist!');
    return null;
  }

  const jumpTo = (i: number) => {
    const lg = app.getLayerGroupByDivId(containerId);
    const vl = lg.getActiveViewLayer();
    const vc = vl.getViewController();
    const vals = vc.getCurrentIndex().getValues();
    vals[2] = i;
    vc.setCurrentIndex(new Index(vals), false);
  };

  return (
    <Box
      component={Paper}
      elevation={3}
      sx={{
        position: 'fixed',
        top: '10%',
        bottom: '10%',
        right: 5,
        width: 150,
      }}
    >
      <List sx={{ height: '100%', overflow: 'auto' }}>
        <ListSubheader>Files:</ListSubheader>
        {itemsList.map(({ imageUid, source, index }) => {
          const sourceChain = source.split('/');
          const name = sourceChain.pop();
          return (
            <ListItem
              key={imageUid}
              ref={(el: HTMLLIElement | null) => {
                itemRefs.current[imageUid] = el;
              }}
              onClick={() => jumpTo(index)}
              alignItems="flex-start"
              sx={{
                borderBottom: '1px solid #ccc',
                background: (theme) =>
                  currentImageId === imageUid
                    ? theme.palette.action.focus
                    : undefined,
              }}
            >
              <ListItemText sx={{ textAlign: 'center' }} primary={name} />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
};
