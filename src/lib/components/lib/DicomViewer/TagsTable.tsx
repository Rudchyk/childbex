'use client';

import { FC } from 'react';
import { App } from 'dwv';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';

interface TagsTableProps {
  app: App;
}

export const TagsTable: FC<TagsTableProps> = ({ app }) => {
  const lg = app.getActiveLayerGroup(); // or app.getLayerGroup(0)
  console.log('🚀 ~ lg:', lg);
  const vl = lg.getActiveViewLayer();
  console.log('🚀 ~ vl:', vl);
  const vc = vl.getViewController();
  console.log('🚀 ~ vc:', vc);
  return (
    <Box>
      <Paper sx={{ width: '100%', overflow: 'hidden' }}>
        dsdfsdfs
        {/* <TableContainer sx={{ maxHeight: 400 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Tag</TableCell>
                <TableCell>Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {displayData.map((item, index) => {
                return (
                  <TableRow key={index}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.value}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer> */}
      </Paper>
    </Box>
  );
};
