'use client';

import { DicomViewer } from '@/lib/components';
import { FC, useState } from 'react';
// import { PatientDWVToolbar } from './PatientDWVToolbar';
import { PatientImage } from '@/types';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

interface PatientImagesGroupProps {
  data: PatientImage[];
}

export const PatientImagesGroup: FC<PatientImagesGroupProps> = ({ data }) => {
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
      // toolbar={
      //   <PatientDWVToolbar
      //     currentItem={currentItem}
      //     onItemUpdate={handleOnItemUpdate}
      //   />
      // }
    />
  );
};
