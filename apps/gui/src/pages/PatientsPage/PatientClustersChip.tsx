import { Chip, CircularProgress } from '@mui/material';
import { FC } from 'react';
import { usePatients } from '../../store/slices/lib/patients.slice/usePatients';

interface PatientClustersChipProps {
  value?: number;
}

export const PatientClustersChip: FC<PatientClustersChipProps> = ({
  value,
}) => {
  // const { isUploadPatientAssetsLoading } = usePatients();
  const { isLoading } = usePatients();
  console.log('🚀 ~ PatientClustersChip ~ isLoading:', isLoading);

  if (isLoading) {
    return <CircularProgress size={14} />;
  }
  if (!value) {
    return null;
  }
  return <Chip label={value} />;
};
