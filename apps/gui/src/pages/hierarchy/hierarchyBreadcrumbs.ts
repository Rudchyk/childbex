import { generatePath } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import type { Patient, SeriesSummary, StudySummary } from '@libs/schemas';
import type { BreadcrumbItem } from '../../components';
import { formatStudyDateTime, seriesTitle } from './hierarchy.utils';

/**
 * Breadcrumbs of the Patient -> Study -> Series pages, from route params and
 * loaded data only: the Patient page is addressed by slug, Study and Series
 * by ids, so a parent is never derived from the current URL. Data that is
 * not loaded (yet), failed or belongs to another URL gets a generic label
 * and, where its route needs it (the patient slug), no link.
 */

type PatientInfo = Pick<Patient, 'name' | 'slug'>;
type StudyInfo = Pick<StudySummary, 'id' | 'studyDate' | 'studyTime'>;
type SeriesInfo = Pick<SeriesSummary, 'seriesNumber' | 'seriesDescription'>;

const patientsCrumb: BreadcrumbItem = {
  label: 'Patients',
  to: guiRoutes.patients,
};

const patientCrumb = (patient?: Partial<PatientInfo>): BreadcrumbItem => ({
  label: patient?.name || 'Patient',
  to: patient?.slug
    ? generatePath(guiRoutes.patient, { slug: patient.slug })
    : undefined,
});

const studyLabel = (study?: StudyInfo) =>
  study ? `Study ${formatStudyDateTime(study)}` : 'Study';

export const patientPageCrumbs = (
  patient?: Pick<Patient, 'name'>
): BreadcrumbItem[] => [patientsCrumb, { label: patient?.name || 'Patient' }];

export const studyPageCrumbs = ({
  patient,
  study,
}: {
  patient?: Partial<PatientInfo>;
  study?: StudyInfo;
}): BreadcrumbItem[] => [
  patientsCrumb,
  patientCrumb(patient),
  { label: studyLabel(study) },
];

export const seriesPageCrumbs = ({
  patientId,
  patientMissing = false,
  patient,
  study,
  series,
}: {
  patientId: string;
  /** The patient is confirmed not to exist: nothing of it is linked. */
  patientMissing?: boolean;
  patient?: Partial<PatientInfo>;
  /**
   * The Study of the loaded Series of the URL (the server checked it is the
   * patient's): the Study is linked only from it, never from URL params.
   */
  study?: StudyInfo;
  series?: SeriesInfo;
}): BreadcrumbItem[] => [
  patientsCrumb,
  patientCrumb(patientMissing ? undefined : patient),
  {
    label: studyLabel(study),
    to:
      !patientMissing && study
        ? generatePath(guiRoutes.patientStudy, { patientId, studyId: study.id })
        : undefined,
  },
  { label: series ? seriesTitle(series) : 'Series' },
];
