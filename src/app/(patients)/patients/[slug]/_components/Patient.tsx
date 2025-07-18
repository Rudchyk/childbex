'use client';

import { DicomViewer } from '@/lib/components';
import { FC, useState } from 'react';
import { PatientDWVToolbar } from './PatientDWVToolbar';
import { PatientImage } from '@/types';

interface PatientProps {
  data: PatientImage[];
}

export const Patient: FC<PatientProps> = ({ data }) => {
  const [currentItem, setCurrentItem] = useState<PatientImage | undefined>();
  const onCurrentItemChange = (currentSource: string) => {
    const currentItem = data.find(({ source }) => currentSource === source);
    setCurrentItem(currentItem);
  };
  return (
    <DicomViewer
      list={data.map(({ source }) => source)}
      onCurrentItemChange={onCurrentItemChange}
      toolbar={<PatientDWVToolbar item={currentItem} />}
    />
  );
};
