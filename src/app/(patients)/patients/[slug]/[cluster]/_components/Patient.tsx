'use client';

import { FC } from 'react';
import { PatientImage } from '../../../../../../types';
import { PatientImagesCluster } from './PatientImagesCluster';
import { PatientBrockenImagesCluster } from './PatientBrockenImagesCluster';

interface PatientProps {
  data: PatientImage[];
  label: string;
}

export const Patient: FC<PatientProps> = ({ data, label }) => {
  if (label === '-1') {
    return <PatientBrockenImagesCluster data={data} />;
  }

  return <PatientImagesCluster data={data} />;
};
