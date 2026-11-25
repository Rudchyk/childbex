import { FC } from 'react';
import { Link, Typography } from '@mui/material';
import {
  gridFilteredSortedRowIdsSelector,
  GridRowId,
  useGridApiContext,
  useGridSelector,
} from '@mui/x-data-grid';
import { Link as RouteLink } from 'react-router-dom';
import { GetPatientsResponse } from '@libs/schemas';
import { getPatientPath, isPatientNavigable } from './patientRowNavigation';

type Patient = GetPatientsResponse[0];

interface PatientRowNumberProps {
  id: GridRowId;
  patient: Patient;
  tabIndex: -1 | 0;
}

/**
 * The row's 1-based position in the displayed order (after sorting,
 * filtering and search, continuing across pages); a link to the patient
 * for live patients, plain text for trashed ones.
 */
export const PatientRowNumber: FC<PatientRowNumberProps> = ({
  id,
  patient,
  tabIndex,
}) => {
  const apiRef = useGridApiContext();
  // Subscribing re-renders the number whenever the displayed order changes.
  const rowIds = useGridSelector(apiRef, gridFilteredSortedRowIdsSelector);
  const number = rowIds.indexOf(id) + 1;

  if (!isPatientNavigable(patient)) {
    return (
      <Typography variant="body2" component="span">
        {number}
      </Typography>
    );
  }
  return (
    <Link
      component={RouteLink}
      to={getPatientPath(patient.slug)}
      tabIndex={tabIndex}
      underline="hover"
      variant="body2"
      aria-label={`Open patient ${patient.name}, row ${number}`}
    >
      {number}
    </Link>
  );
};
