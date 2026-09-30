/**
 * Patient -> Study -> Series navigation: lists render from the hierarchy
 * API and link only to the id-based Study/Series routes (never to the
 * legacy cluster page).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { guiRoutes } from '@libs/constants';
import { LegacyClusterNotice } from '../LegacyClusterPage/LegacyClusterPage';
import type { PatientStudiesResponse, StudySeriesResponse } from '@libs/schemas';
import { StudySeriesList } from './StudyPage';
import { PatientStudies } from '../PatientPage/PatientStudies';

// Page chrome (and dwv behind it) is not under test.
jest.mock('../../layouts', () => ({ DefaultLayout: () => null }));
jest.mock('../../templates', () => ({ PageTmpl: () => null }));
jest.mock('../../components', () => ({}));

let mockStudies: PatientStudiesResponse | undefined;
jest.mock('../../store/apis', () => ({
  useGetPatientStudiesQuery: () => ({ data: mockStudies, isLoading: false, isError: false }),
}));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const STUDY = '44444444-4444-4444-8444-444444444444';
const summary = { total: 4, broken: 1, notReviewed: 1, normal: 1, abnormal: 1, uncertain: 0, conflicted: 0 };

const links = (container: HTMLElement) =>
  [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

describe('hierarchy navigation', () => {
  it('the patient page lists studies linking to /patients/:id/studies/:studyId', () => {
    mockStudies = {
      patientId: PATIENT,
      studies: [
        { id: STUDY, studyDate: '2026-01-02', studyTime: '101500', seriesCount: 2, imageCount: 4, review: summary },
      ],
    };
    const { container } = render(
      <MemoryRouter>
        <PatientStudies patientId={PATIENT} />
      </MemoryRouter>
    );
    expect(screen.getByText('Study 2026-01-02 10:15')).toBeTruthy();
    expect(screen.getByText('2 series')).toBeTruthy();
    expect(screen.getByText('reviewed 2/3')).toBeTruthy();
    expect(links(container)).toEqual([`/patients/${PATIENT}/studies/${STUDY}`]);
  });

  it('a study lists its series linking to the series route, flagging unsupported ones', () => {
    const data: StudySeriesResponse = {
      study: { id: STUDY, studyDate: null, studyTime: null, seriesCount: 2, imageCount: 4, review: summary },
      series: [
        { id: 's1', studyId: STUDY, seriesNumber: 1, seriesDescription: 'LOCALIZER', modality: 'CT', imageType: null, convolutionKernel: null, sliceThickness: null, imageCount: 3, review: summary, orientationCount: 3, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: false },
        { id: 's2', studyId: STUDY, seriesNumber: 2, seriesDescription: 'AXIAL', modality: 'CT', imageType: null, convolutionKernel: null, sliceThickness: null, imageCount: 1, review: summary, orientationCount: 1, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: true },
      ],
    };
    const { container } = render(
      <MemoryRouter>
        <StudySeriesList patientId={PATIENT} data={data} isLoading={false} isError={false} />
      </MemoryRouter>
    );
    expect(screen.getByText('#1 LOCALIZER')).toBeTruthy();
    expect(screen.getByText('CT · not viewable as one stack')).toBeTruthy();
    expect(screen.getByText('#2 AXIAL')).toBeTruthy();
    expect(links(container)).toEqual([
      `/patients/${PATIENT}/studies/${STUDY}/series/s1`,
      `/patients/${PATIENT}/studies/${STUDY}/series/s2`,
    ]);
  });

  it('old cluster bookmarks get a notice linking to the patient (no guessed Series)', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/patients/synthetic/0']}>
        <Routes>
          <Route path={guiRoutes.legacyClusterPage} element={<LegacyClusterNotice />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('This page no longer exists')).toBeTruthy();
    expect(links(container)).toEqual(['/patients/synthetic']);
  });

  it('no page uses cluster routes, queries, the inReview switch or cluster deletion', () => {
    const pages = path.join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) {
          files.push(full);
        }
      }
    };
    walk(pages);
    const offenders = files.filter((file) =>
      /patientImagesCluster|ImagesCluster|clusterId|inReview|\/clusters\//i.test(
        readFileSync(file, 'utf8')
      )
    );
    expect(offenders).toEqual([]);
  });
});
