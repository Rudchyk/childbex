import { Chip, CircularProgress } from '@mui/material';
import { FC } from 'react';
import { usePatients } from '../../store/slices';

interface PatientCountChipProps {
  value?: number;
}

export const PatientCountChip: FC<PatientCountChipProps> = ({
  value,
}) => {
  const { isLoading } = usePatients();

  if (isLoading) {
    return <CircularProgress size={14} />;
  }
  if (!value) {
    return null;
  }
  return <Chip label={value} />;
};
