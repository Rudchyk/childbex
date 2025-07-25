'use client';

import { DicomViewer } from '@/lib/components';
import { FC, useState } from 'react';
// import { PatientDWVToolbar } from './PatientDWVToolbar';
import { PatientImage } from '@/types';
import AcUnitIcon from '@mui/icons-material/AcUnit';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { PatientImagesSidebar } from './PatientImagesSidebar';

interface PatientImagesProps {
  data: PatientImage[];
  inReview: boolean;
}

export const PatientImages: FC<PatientImagesProps> = ({ data }) => {
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
      <PatientImagesSidebar item={currentItem} />
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
