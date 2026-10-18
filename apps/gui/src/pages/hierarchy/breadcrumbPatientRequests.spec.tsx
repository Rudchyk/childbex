/**
 * Requests behind the Study/Series breadcrumbs with real RTK Query
 * (createApi, store, middleware, query hooks): the patient is requested
 * once for its Study and Series pages and not again on rerenders; a patient
 * confirmed missing (404) is not linked, a failed request otherwise
 * (network) keeps the Series' patient link. Synthetic data only.
 *
 * The app's `apiStore` cannot be loaded under Jest (it reads
 * `import.meta.env`), so its three hierarchy queries are declared here as
 * there: same routes and tag, RTK Query's default cache options (the last
 * test checks that apiStore overrides none of them).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { createApi, type BaseQueryFn } from '@reduxjs/toolkit/query/react';
import { Provider } from 'react-redux';
import {
  MemoryRouter,
  NavigateFunction,
  Route,
  Routes,
  generatePath,
  useNavigate,
} from 'react-router-dom';
import { apiRoutes, guiRoutes } from '@libs/constants';
import type {
  GetPatientResponse,
  IDProperty,
  PatientSeriesParams,
  PatientSeriesResponse,
  PatientStudyParams,
  SeriesSummary,
  StudySeriesResponse,
} from '@libs/schemas';
import { Component as StudyPage } from '../StudyPage/StudyPage';
import { Component as SeriesPage } from '../SeriesPage/SeriesPage';

jest.mock('../../layouts', () => {
  const { Breadcrumbs } = jest.requireActual(
    '../../components/lib/Breadcrumbs/Breadcrumbs'
  );
  return {
    DefaultLayout: ({ breadcrumbs }: { breadcrumbs?: unknown }) => (
      <Breadcrumbs items={breadcrumbs} />
    ),
  };
});
jest.mock('../../templates', () => ({ PageTmpl: () => null }));
jest.mock('../../components', () => ({}));
jest.mock('../SeriesPage/SeriesImages', () => ({ SeriesImages: () => null }));
jest.mock('../SeriesPage/LLMCheckItems', () => ({ LLMCheckItems: () => null }));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const STUDY = '44444444-4444-4444-8444-444444444444';
const SERIES = '55555555-5555-4555-8555-555555555555';
const summary = { total: 1, broken: 0, notReviewed: 1, normal: 0, abnormal: 0, uncertain: 0, conflicted: 0 };
const series: SeriesSummary = {
  id: SERIES, studyId: STUDY, seriesNumber: 3, seriesDescription: 'CT Abdomen', modality: 'CT',
  imageType: null, convolutionKernel: null, sliceThickness: null, imageCount: 1, review: summary,
  orientationCount: 1, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: true,
};
const patientUrl = generatePath(apiRoutes.patient, { id: PATIENT });
const responses: Record<string, unknown> = {
  [patientUrl]: {
    id: PATIENT, name: 'Test Patient A', slug: 'test-patient-a', notes: '',
    creatorId: PATIENT, creatorName: 'Reviewer',
  } as GetPatientResponse,
  [generatePath(apiRoutes.patientStudySeries, { patientId: PATIENT, studyId: STUDY })]: {
    study: { id: STUDY, studyDate: '2026-01-02', studyTime: '101500', seriesCount: 1, imageCount: 1, review: summary },
    series: [series],
  } as StudySeriesResponse,
  [generatePath(apiRoutes.patientSeries, { patientId: PATIENT, seriesId: SERIES })]: {
    patient: { id: PATIENT, slug: 'test-patient-a' },
    study: { id: STUDY, studyDate: '2026-01-02', studyTime: '101500' },
    series,
    images: [],
    review: { imageSetRevision: 'r1', completions: [] },
  } as PatientSeriesResponse,
};

/** URLs requested from the (fake) server, in order. */
let requests: string[] = [];
/** Answers that replace a URL's response (e.g. a 404). */
let failures: Record<string, unknown> = {};

const fakeBaseQuery: BaseQueryFn<string, unknown, unknown> = async (url) => {
  requests.push(url);
  if (failures[url]) return { error: failures[url] };
  return { data: responses[url] };
};

const mockApi = createApi({
  reducerPath: 'apiStore',
  baseQuery: fakeBaseQuery,
  tagTypes: ['patient'],
  endpoints: (builder) => ({
    getPatient: builder.query<GetPatientResponse, IDProperty>({
      query: ({ id }) => generatePath(apiRoutes.patient, { id }),
      providesTags: ['patient'],
    }),
    getStudySeries: builder.query<StudySeriesResponse, PatientStudyParams>({
      query: ({ patientId, studyId }) =>
        generatePath(apiRoutes.patientStudySeries, { patientId, studyId }),
      providesTags: ['patient'],
    }),
    getPatientSeries: builder.query<PatientSeriesResponse, PatientSeriesParams>({
      query: ({ patientId, seriesId }) =>
        generatePath(apiRoutes.patientSeries, { patientId, seriesId }),
      providesTags: ['patient'],
    }),
  }),
});

jest.mock('../../store/apis', () => ({
  useGetPatientQuery: (...args: never[]) =>
    (mockApi.useGetPatientQuery as (...a: never[]) => unknown)(...args),
  useGetStudySeriesQuery: (...args: never[]) =>
    (mockApi.useGetStudySeriesQuery as (...a: never[]) => unknown)(...args),
  useGetPatientSeriesQuery: (...args: never[]) =>
    (mockApi.useGetPatientSeriesQuery as (...a: never[]) => unknown)(...args),
}));

const studyUrl = generatePath(guiRoutes.patientStudy, { patientId: PATIENT, studyId: STUDY });
const seriesUrl = generatePath(guiRoutes.patientSeries, {
  patientId: PATIENT,
  studyId: STUDY,
  seriesId: SERIES,
});

let navigate: NavigateFunction = () => undefined;
const NavigateProbe = () => {
  navigate = useNavigate();
  return null;
};

const tree = (url: string, store: ReturnType<typeof makeStore>) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={[url]}>
      <NavigateProbe />
      <Routes>
        <Route path={guiRoutes.patientStudy} element={<StudyPage />} />
        <Route path={guiRoutes.patientSeries} element={<SeriesPage />} />
        <Route path="*" element={<div>other page</div>} />
      </Routes>
    </MemoryRouter>
  </Provider>
);
const makeStore = () =>
  configureStore({
    reducer: { [mockApi.reducerPath]: mockApi.reducer },
    middleware: (getDefault) => getDefault().concat(mockApi.middleware),
  });

const nav = () => screen.getByRole('navigation', { name: 'breadcrumb' });
const patientCrumb = () => within(nav()).getAllByRole('listitem')[2];
const requestsOf = (url: string) => requests.filter((r) => r === url).length;

beforeEach(() => {
  requests = [];
  failures = {};
});

describe('breadcrumb patient requests', () => {
  it('Study -> Series -> Study requests the patient once; rerenders request nothing', async () => {
    const store = makeStore();
    const { rerender } = render(tree(studyUrl, store));
    await screen.findByRole('link', { name: 'Test Patient A' });

    act(() => navigate(seriesUrl));
    await screen.findByText('#3 CT Abdomen');
    expect(within(nav()).getByRole('link', { name: 'Test Patient A' })).toBeTruthy();

    // Back to the Study through its breadcrumb.
    fireEvent.click(within(nav()).getByRole('link', { name: 'Study 2026-01-02 10:15' }));
    await screen.findByText('Study 2026-01-02 10:15');

    rerender(tree(studyUrl, store));
    rerender(tree(studyUrl, store));
    expect(requestsOf(patientUrl)).toBe(1);
    expect(requests).toHaveLength(3); // patient, Study, Series: once each
  });

  it('a patient confirmed missing (404) is not linked from the Series', async () => {
    failures[patientUrl] = { status: 404, data: { message: 'Not found' } };
    render(tree(seriesUrl, makeStore()));
    await screen.findByText('#3 CT Abdomen');
    await waitFor(() => expect(requestsOf(patientUrl)).toBe(1));
    await waitFor(() => expect(patientCrumb().textContent).toBe('Patient'));
    // The Series' slug would lead to a patient page that no longer exists.
    expect(patientCrumb().querySelector('a')).toBeNull();
  });

  it('a network failure keeps the Series patient link (the Series confirmed the patient)', async () => {
    failures[patientUrl] = { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' };
    render(tree(seriesUrl, makeStore()));
    await screen.findByText('#3 CT Abdomen');
    await waitFor(() => expect(requestsOf(patientUrl)).toBe(1));
    expect(within(nav()).getByRole('link', { name: 'Patient' }).getAttribute('href')).toBe(
      '/patients/test-patient-a'
    );
  });

  it('a patient confirmed missing on the Study page has no link either', async () => {
    failures[patientUrl] = { status: 404, data: { message: 'Not found' } };
    render(tree(studyUrl, makeStore()));
    await screen.findByText('Study 2026-01-02 10:15');
    await waitFor(() => expect(requestsOf(patientUrl)).toBe(1));
    expect(patientCrumb().textContent).toBe('Patient');
    expect(patientCrumb().querySelector('a')).toBeNull();
  });

  it("apiStore keeps RTK Query's default caching (as declared above)", () => {
    const source = readFileSync(
      path.join(__dirname, '../../store/apis/lib/apiStore.ts'),
      'utf8'
    );
    expect(source).not.toMatch(
      /refetchOnMountOrArgChange|keepUnusedDataFor|refetchOnFocus|refetchOnReconnect/
    );
  });
});
