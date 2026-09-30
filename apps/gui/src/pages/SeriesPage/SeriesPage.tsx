import { FC } from 'react';
import { Alert, AlertTitle, Chip, Stack, Typography } from '@mui/material';
import { useParams } from 'react-router-dom';
import pluralize from 'pluralize';
import type { PatientSeriesResponse } from '@libs/schemas';
import { DefaultLayout } from '../../layouts';
import { PageTmpl } from '../../templates';
import { WithLoader } from '../../hoc';
import { useGetPatientSeriesQuery } from '../../store/apis';
import { ReviewSummaryChips } from '../hierarchy/ReviewSummaryChips';
import { formatStudyDateTime, seriesTitle } from '../hierarchy/hierarchy.utils';
import { SeriesImages } from './SeriesImages';

const BrokenImages: FC<{ data: PatientSeriesResponse }> = ({ data }) => {
  const broken = data.images.filter((image) => image.isBroken);
  if (!broken.length) return null;
  return (
    <Alert severity="warning">
      <AlertTitle>
        {broken.length} broken {pluralize('image', broken.length)} (not
        displayed, not included in Finish review)
      </AlertTitle>
      {broken.map((image) => (
        <div key={image.id}>
          Instance {image.instanceNumber ?? '?'}: {image.brokenReason ?? 'unknown'}
        </div>
      ))}
    </Alert>
  );
};

export const SeriesContent = WithLoader<PatientSeriesResponse>(({ data }) => {
  const { series } = data;
  // Server-derived: the same rule as Series Finish review.
  const simple = series.reviewable;
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip size="small" label={`Study ${formatStudyDateTime(data.study)}`} />
        {!!series.modality && <Chip size="small" label={series.modality} />}
        <ReviewSummaryChips summary={series.review} />
      </Stack>
      <BrokenImages data={data} />
      {simple ? (
        <SeriesImages data={data} />
      ) : (
        <Alert severity="error">
          <AlertTitle>This series cannot be reviewed as a whole yet</AlertTitle>
          It has {series.orientationCount}{' '}
          {pluralize('orientation', series.orientationCount)},{' '}
          {series.geometryCount} image{' '}
          {pluralize('geometry', series.geometryCount)},{' '}
          {series.geometryIncompleteCount} image(s) with incomplete geometry
          and {series.multiFrameImageCount} multi-frame{' '}
          {pluralize('image', series.multiFrameImageCount)}. The viewer shows
          one stack of single-frame images of one orientation and geometry
          only, so it would not show the complete series: it is not displayed,
          and Finish review is not available. Its images still count in the
          review summaries.
        </Alert>
      )}
    </Stack>
  );
});

export const Component = () => {
  const { patientId = '', seriesId = '' } = useParams<{
    patientId: string;
    seriesId: string;
  }>();
  const { data, isLoading, isError, error } = useGetPatientSeriesQuery(
    { patientId, seriesId },
    { skip: !patientId || !seriesId }
  );
  return (
    <DefaultLayout>
      <PageTmpl
        customTitle={
          <Typography component="h1" variant="h3">
            {data ? seriesTitle(data.series) : 'Series'}
          </Typography>
        }
      >
        <SeriesContent
          data={data}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />
      </PageTmpl>
    </DefaultLayout>
  );
};
