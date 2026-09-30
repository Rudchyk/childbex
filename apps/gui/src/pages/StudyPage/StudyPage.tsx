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
  Typography,
} from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import WarningIcon from '@mui/icons-material/Warning';
import { generatePath, Link as RouteLink, useParams } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import type { PatientStudyParams, StudySeriesResponse } from '@libs/schemas';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { WithLoader } from '../../hoc';
import { useGetStudySeriesQuery } from '../../store/apis';
import { ReviewSummaryChips } from '../hierarchy/ReviewSummaryChips';
import {
  formatStudyDateTime,
  isSimpleStackSeries,
  seriesTitle,
} from '../hierarchy/hierarchy.utils';

interface StudySeriesListProps {
  patientId: string;
}

export const StudySeriesList = WithLoader<StudySeriesResponse, StudySeriesListProps>(
  ({ data, patientId }) => (
    <Stack spacing={2}>
      <ReviewSummaryChips summary={data.study.review} />
      {!data.series.length && <Alert severity="info">No series.</Alert>}
      <List>
        {data.series.map((series) => (
          <ListItem key={series.id} disablePadding>
            <ListItemButton
              component={RouteLink}
              to={generatePath(guiRoutes.patientSeries, {
                patientId,
                studyId: data.study.id,
                seriesId: series.id,
              })}
            >
              <ListItemAvatar>
                <Avatar>
                  {isSimpleStackSeries(series) ? <ViewListIcon /> : <WarningIcon />}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={seriesTitle(series)}
                secondary={[
                  series.modality,
                  isSimpleStackSeries(series)
                    ? null
                    : 'not viewable as one stack',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <ReviewSummaryChips summary={series.review} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Stack>
  )
);

const StudyTitle: FC<{ data?: StudySeriesResponse }> = ({ data }) => (
  <Typography component="h1" variant="h3">
    {data ? `Study ${formatStudyDateTime(data.study)}` : 'Study'}
  </Typography>
);

export const Component = () => {
  const { patientId = '', studyId = '' } = useParams<PatientStudyParams>();
  const { data, isLoading, isError, error } = useGetStudySeriesQuery(
    { patientId, studyId },
    { skip: !patientId || !studyId }
  );
  return (
    <DefaultLayout>
      <PageTmpl customTitle={<StudyTitle data={data} />}>
        <StudySeriesList
          patientId={patientId}
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
