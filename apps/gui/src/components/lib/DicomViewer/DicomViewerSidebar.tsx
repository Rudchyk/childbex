import { FC, ReactElement, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  // ListSubheader,
  Paper,
} from '@mui/material';
import { App, Index } from 'dwv';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

export interface Item {
  imageUid: string;
  source: string;
  index: number;
}

export interface DicomViewerSidebarProps {
  items: Item[];
  currentImageId?: string;
  app: App | null;
  icon?: (source: string) => ReactElement;
}

export const DicomViewerSidebar: FC<DicomViewerSidebarProps> = ({
  items = [],
  currentImageId,
  icon = () => <InsertDriveFileIcon />,
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

  const jumpTo = (i: number) => {
    if (app) {
      const lg = app.getActiveLayerGroup();
      if (lg) {
        const vl = lg.getActiveViewLayer();
        if (vl) {
          const vc = vl.getViewController();
          const vals = vc.getCurrentIndex().getValues();
          vals[2] = i;
          vc.setCurrentIndex(new Index(vals), false);
        }
      }
    }
  };

  if (!items.length) {
    return null;
  }

  return (
    <Box
      component={Paper}
      elevation={3}
      sx={{
        position: 'fixed',
        top: '10%',
        bottom: '10%',
        right: 5,
        width: 200,
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
              <ListItemIcon>{icon(source)}</ListItemIcon>
              <ListItemText primary={name} />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
};
