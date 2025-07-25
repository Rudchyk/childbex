'use client';

import { DicomViewer } from '@/lib/components';
import { FC, useState } from 'react';
// import { PatientDWVToolbar } from './PatientDWVToolbar';
import { PatientImage, PatientImageCluster } from '@/types';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { Box, Paper } from '@mui/material';
import { PatientImagesTags } from './PatientImagesTags';

interface PatientImagesProps {
  data: PatientImage[];
  imagesCluster: PatientImageCluster;
}

export const PatientImages: FC<PatientImagesProps> = ({
  data,
  imagesCluster,
}) => {
  const [itemsMapping, setItemsMapping] = useState(
    Object.fromEntries(data.map((item) => [item.source, item]))
  );
  const [currentItem, setCurrentItem] = useState<PatientImage | undefined>();
  const onCurrentItemChange = (newCurrentSource: string) => {
    const item = itemsMapping[newCurrentSource];
    if (item) {
      setCurrentItem(item);
    } else {
      console.warn(`${newCurrentSource} does note exist!`);
    }
  };
  const handleOnItemUpdate = (source: string) => {
    console.log('source', source);

    // setItemsMapping({
    //   ...itemsMapping,
    //   [source]: {
    //     ...itemsMapping[source],
    //     type,
    //   },
    // });
  };
  return (
    <>
      <Box
        component={Paper}
        elevation={3}
        sx={{
          position: 'fixed',
          top: '10%',
          bottom: '10%',
          left: 5,
          width: 300,
        }}
      >
        <PatientImagesTags imagesCluster={imagesCluster} />
      </Box>
      <DicomViewer
        list={data.map(({ source }) => source)}
        onCurrentItemChange={onCurrentItemChange}
        sidebarItemIcon={(source: string) =>
          itemsMapping[source].isAbnormal ? (
            <AcUnitIcon />
          ) : (
            <InsertDriveFileIcon />
          )
        }
      />
    </>
  );
};
