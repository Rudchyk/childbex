import { FC } from 'react';
import {
  Alert,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Stack,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import pluralize from 'pluralize';
import { generatePath, Link as RouteLink } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import { useGetPatientStudiesQuery } from '../../store/apis';
import { WithLoader } from '../../hoc';
import type { PatientStudiesResponse } from '@libs/schemas';
import { ReviewSummaryChips } from '../hierarchy/ReviewSummaryChips';
import { formatStudyDateTime } from '../hierarchy/hierarchy.utils';

const StudiesList = WithLoader<PatientStudiesResponse>(({ data }) => (
  <Stack spacing={2}>
    {!data.studies.length && <Alert severity="info">No studies yet.</Alert>}
    <List>
      {data.studies.map((study) => (
        <ListItem key={study.id} disablePadding>
          <ListItemButton
            component={RouteLink}
            to={generatePath(guiRoutes.patientStudy, {
              patientId: data.patientId,
              studyId: study.id,
            })}
          >
            <ListItemAvatar>
              <Avatar>
                <FolderIcon />
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={`Study ${formatStudyDateTime(study)}`}
              secondary={`${study.seriesCount} ${pluralize(
                'series',
                study.seriesCount
              )}`}
            />
            <ReviewSummaryChips summary={study.review} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  </Stack>
));

interface PatientStudiesProps {
  patientId: string;
}

/** The patient's DICOM Studies (the review entry point). */
export const PatientStudies: FC<PatientStudiesProps> = ({ patientId }) => {
  const { data, isLoading, isError, error } = useGetPatientStudiesQuery({
    patientId,
  });
  return (
    <StudiesList data={data} isLoading={isLoading} isError={isError} error={error} />
  );
};
