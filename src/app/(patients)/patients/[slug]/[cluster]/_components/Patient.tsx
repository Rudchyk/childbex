'use client';

import { FC } from 'react';
import { PatientImage } from '@/types';
import { PatientImagesGroup } from './PatientImagesGroup';
import { PatientBrockenImagesGroup } from './PatientBrockenImagesGroup';

interface PatientProps {
  data: PatientImage[];
  label: string;
}

export const Patient: FC<PatientProps> = ({ data, label }) => {
  if (label === 'BROCKEN') {
    return <PatientBrockenImagesGroup data={data} />;
  }

  return <PatientImagesGroup data={data} />;
};
