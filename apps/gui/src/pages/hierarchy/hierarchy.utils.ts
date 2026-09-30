import type { SeriesSummary, StudySummary } from '@libs/schemas';

/** DICOM StudyDate (YYYY-MM-DD) and StudyTime (HHMMSS[.f]) for display. */
export const formatStudyDateTime = ({
  studyDate,
  studyTime,
}: Pick<StudySummary, 'studyDate' | 'studyTime'>) => {
  const time =
    studyTime && /^\d{4}/.test(studyTime)
      ? `${studyTime.slice(0, 2)}:${studyTime.slice(2, 4)}`
      : '';
  return [studyDate ?? 'Unknown date', time].filter(Boolean).join(' ');
};

export const seriesTitle = ({
  seriesNumber,
  seriesDescription,
}: Pick<SeriesSummary, 'seriesNumber' | 'seriesDescription'>) =>
  [
    seriesNumber !== null ? `#${seriesNumber}` : null,
    seriesDescription || 'Series without description',
  ]
    .filter(Boolean)
    .join(' ');

/**
 * The viewer shows one stack of single-frame slices with one orientation:
 * only such a Series can be viewed and finished as a whole.
 */
export const isSimpleStackSeries = ({
  orientationCount,
  multiFrameImageCount,
}: Pick<SeriesSummary, 'orientationCount' | 'multiFrameImageCount'>) =>
  orientationCount <= 1 && multiFrameImageCount === 0;
