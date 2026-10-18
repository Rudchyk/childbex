/**
 * Patient -> Study -> Series breadcrumbs through the real pages and router:
 * readable labels (never ids), parents resolved from the route definitions
 * (the patient by slug, Study and Series by id), the current page not a
 * link, generic labels while data is loading or missing, and never the
 * previous patient or Study after switching. Synthetic data only.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  MemoryRouter,
  NavigateFunction,
  Route,
  RouteObject,
  Routes,
  generatePath,
  matchRoutes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { appRoutes } from '../../routes/appRoutes';
import { guiRoutes } from '@libs/constants';
import type {
  GetPatientResponse,
  PatientSeriesResponse,
  SeriesSummary,
  StudySeriesResponse,
  StudySummary,
} from '@libs/schemas';
import { Component as PatientPage } from '../PatientPage/PatientPage';
import { Component as StudyPage } from '../StudyPage/StudyPage';
import { Component as SeriesPage } from '../SeriesPage/SeriesPage';

// The layout renders only the real breadcrumbs; page content is not under test.
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
jest.mock('../../components', () => ({ PageTitle: () => null }));
jest.mock('../PatientPage/AddPatientImages/AddPatientImages', () => ({
  AddPatientImages: () => null,
}));
jest.mock('../SeriesPage/SeriesImages', () => ({ SeriesImages: () => null }));
jest.mock('../SeriesPage/LLMCheckItems', () => ({ LLMCheckItems: () => null }));
// The real route table is only matched against (its lazy pages never load).
jest.mock('../../auth/ProtectedRoute', () => ({ ProtectedRoute: () => null }));
jest.mock('../ErrorPage/ErrorPage', () => () => null);

const P_A = '11111111-1111-4111-8111-111111111111';
const P_B = '22222222-2222-4222-8222-222222222222';
const STUDY_A = '44444444-4444-4444-8444-444444444444';
const STUDY_A2 = '66666666-6666-4666-8666-666666666666';
const STUDY_B = '77777777-7777-4777-8777-777777777777';
const SERIES_A = '55555555-5555-4555-8555-555555555555';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/;

const summary = { total: 1, broken: 0, notReviewed: 1, normal: 0, abnormal: 0, uncertain: 0, conflicted: 0 };
const patient = (id: string, name: string, slug: string) =>
  ({ id, name, slug, notes: '', creatorId: id, creatorName: 'Reviewer' }) as GetPatientResponse;
const study = (id: string, studyDate: string | null): StudySummary => ({
  id, studyDate, studyTime: studyDate ? '101500' : null, seriesCount: 1, imageCount: 1, review: summary,
});
const seriesSummary: SeriesSummary = {
  id: SERIES_A, studyId: STUDY_A, seriesNumber: 3, seriesDescription: 'CT Abdomen', modality: 'CT',
  imageType: null, convolutionKernel: null, sliceThickness: null, imageCount: 1, review: summary,
  orientationCount: 1, multiFrameImageCount: 0, geometryCount: 1, geometryIncompleteCount: 0, reviewable: true,
};

const mockPatients: Record<string, GetPatientResponse> = {
  [P_A]: patient(P_A, 'Test Patient A', 'test-patient-a'),
  [P_B]: patient(P_B, 'Test Patient B', 'test-patient-b'),
};
const mockStudies: Record<string, StudySeriesResponse> = {
  [STUDY_A]: { study: study(STUDY_A, '2026-01-02'), series: [seriesSummary] },
  [STUDY_A2]: { study: study(STUDY_A2, '2026-03-04'), series: [] },
  [STUDY_B]: { study: study(STUDY_B, null), series: [] },
};
const mockSeriesById: Record<string, PatientSeriesResponse> = {
  [SERIES_A]: {
    patient: { id: P_A, slug: 'test-patient-a' },
    study: { id: STUDY_A, studyDate: '2026-01-02', studyTime: '101500' },
    series: seriesSummary,
    images: [],
    review: { imageSetRevision: 'r1', completions: [] },
  },
};

/** Ids (patient ids, slugs, study ids) whose requests are still pending. */
let mockPending = new Set<string>();
/** Ids the patient query was not skipped for. */
let mockPatientQueryIds: string[] = [];
/** RTK Query's `data`: the last result, of any argument, while fetching. */
let mockLastBySlug: GetPatientResponse | undefined;
let mockLastStudy: StudySeriesResponse | undefined;
const mockBySlug = (slug: string) =>
  Object.values(mockPatients).find((p) => p.slug === slug);

jest.mock('../../store/apis', () => ({
  useGetPatientBySlugQuery: ({ slug }: { slug: string }) => {
    if (!mockPending.has(slug)) mockLastBySlug = mockBySlug(slug);
    return { data: mockLastBySlug, isLoading: mockPending.has(slug), isError: false };
  },
  useGetPatientQuery: ({ id }: { id: string }, options?: { skip?: boolean }) => {
    if (options?.skip) return {};
    mockPatientQueryIds.push(id);
    if (mockPending.has(id)) return {};
    return mockPatients[id]
      ? { currentData: mockPatients[id] }
      : { error: { status: 404, data: { message: 'Not found' } } };
  },
  useGetStudySeriesQuery: ({ patientId, studyId }: { patientId: string; studyId: string }) => {
    // Pending by Study id, or by this query (patient and Study).
    const pending = mockPending.has(studyId) || mockPending.has(`${patientId}/${studyId}`);
    if (!pending) mockLastStudy = mockStudies[studyId];
    return {
      data: mockLastStudy,
      currentData: pending ? undefined : mockStudies[studyId],
      isLoading: pending,
      isError: false,
    };
  },
  useGetPatientSeriesQuery: ({ seriesId }: { seriesId: string }) => ({
    currentData: mockPending.has(seriesId) ? undefined : mockSeriesById[seriesId],
    isFetching: mockPending.has(seriesId),
    isError: false,
  }),
  useGetPatientStudiesQuery: () => ({ data: undefined, isLoading: true, isError: false }),
}));

const { Breadcrumbs } = jest.requireActual(
  '../../components/lib/Breadcrumbs/Breadcrumbs'
);

const studyUrl = (patientId: string, studyId: string) =>
  generatePath(guiRoutes.patientStudy, { patientId, studyId });
const seriesUrl = (patientId: string, studyId: string, seriesId: string) =>
  generatePath(guiRoutes.patientSeries, { patientId, studyId, seriesId });

/**
 * The route of the app's real route table (routes/appRoutes) a URL opens:
 * its path pattern, '/' for the home page, null when no route matches
 * (the 404 page).
 */
const routeOf = (href: string) => {
  const leaf = matchRoutes(appRoutes, href)?.at(-1)?.route;
  if (!leaf) return null;
  return leaf.index ? guiRoutes.home : (leaf.path ?? null);
};
const routePaths = (routes: RouteObject[]): string[] =>
  routes.flatMap((route) => [
    ...(route.path ? [route.path] : []),
    ...routePaths(route.children ?? []),
  ]);

/**
 * The router's location and history. The real route table cannot be
 * mounted here (its lazy pages need the data router, whose navigations
 * build a fetch `Request`, which jsdom lacks): the test router uses the same
 * guiRoutes patterns, checked against the real table below, and every
 * breadcrumb href is resolved through the real table (routeOf).
 */
const router = {
  pathname: '',
  navigate: (() => undefined) as NavigateFunction,
};
const RouterProbe = () => {
  router.pathname = useLocation().pathname;
  router.navigate = useNavigate();
  return null;
};

const setup = (url: string) => {
  render(
    <MemoryRouter initialEntries={[url]}>
      <RouterProbe />
      <Routes>
        <Route path={guiRoutes.home} element={<div>home page</div>} />
        {/* The Patients page passes no trail: the static route label applies. */}
        <Route path={guiRoutes.patients} element={<Breadcrumbs />} />
        <Route path={guiRoutes.patient} element={<PatientPage />} />
        <Route path={guiRoutes.legacyClusterPage} element={<div>legacy page</div>} />
        <Route path={guiRoutes.patientStudy} element={<StudyPage />} />
        <Route path={guiRoutes.patientSeries} element={<SeriesPage />} />
        <Route path="*" element={<div>not found</div>} />
      </Routes>
    </MemoryRouter>
  );
  return {
    path: () => router.pathname,
    navigate: (to: string | number) =>
      act(() => {
        router.navigate(to as never);
      }),
  };
};

const nav = () => screen.getByRole('navigation', { name: 'breadcrumb' });
/**
 * [label, href | null]; the current page has no href. Every href must open
 * a page of the real route table (never the 404 page or the legacy notice).
 */
const crumbs = () => {
  const items = [...nav().querySelectorAll('li.MuiBreadcrumbs-li')].map((li) => [
    li.textContent,
    li.querySelector('a')?.getAttribute('href') ?? null,
  ]);
  for (const [, href] of items) {
    if (href === null) continue;
    expect([href, routeOf(href)]).not.toEqual([href, null]);
    expect([href, routeOf(href)]).not.toEqual([href, guiRoutes.legacyClusterPage]);
  }
  return items;
};
/** [label, route pattern of the real route table] of every link. */
const linkRoutes = () =>
  crumbs()
    .filter(([, href]) => href !== null)
    .map(([label, href]) => [label, routeOf(href as string)]);
const current = () => nav().querySelector('[aria-current="page"]')?.textContent;
const click = (label: string) =>
  fireEvent.click(within(nav()).getByRole('link', { name: label }));

beforeEach(() => {
  mockPending = new Set();
  mockPatientQueryIds = [];
  mockLastBySlug = undefined;
  mockLastStudy = undefined;
});

describe('route table', () => {
  it('the test router uses the routes of the real route table', () => {
    expect(routePaths(appRoutes)).toEqual(
      expect.arrayContaining([
        guiRoutes.patients,
        guiRoutes.patient,
        guiRoutes.legacyClusterPage,
        guiRoutes.patientStudy,
        guiRoutes.patientSeries,
      ])
    );
    expect(routeOf(seriesUrl(P_A, STUDY_A, SERIES_A))).toBe(guiRoutes.patientSeries);
  });

  it('URL prefixes (the former breadcrumbs) are not hierarchy pages', () => {
    // The patient id where the Patient page expects a slug (API 404).
    expect(routeOf(`/patients/${P_A}`)).toBe(guiRoutes.patient);
    expect(routeOf(`/patients/${P_A}/studies`)).toBe(guiRoutes.legacyClusterPage);
    expect(routeOf(`${studyUrl(P_A, STUDY_A)}/series`)).toBeNull();
  });
});

describe('hierarchy breadcrumbs', () => {
  it('Patients page: Home > Patients (current)', () => {
    setup(guiRoutes.patients);
    expect(crumbs()).toEqual([['Home', '/'], ['Patients', null]]);
    expect(current()).toBe('Patients');
  });

  it("Patient page: the patient's name, the current page", () => {
    setup('/patients/test-patient-a');
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Test Patient A', null],
    ]);
    expect(current()).toBe('Test Patient A');
  });

  it('Study page: the patient links to its slug route, the Study is labelled by date', () => {
    setup(studyUrl(P_A, STUDY_A));
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Test Patient A', '/patients/test-patient-a'],
      ['Study 2026-01-02 10:15', null],
    ]);
    expect(nav().textContent).not.toMatch(UUID);
  });

  it('Series page (direct deep link): every ancestor resolves to its route, no ids shown', () => {
    setup(seriesUrl(P_A, STUDY_A, SERIES_A));
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Test Patient A', '/patients/test-patient-a'],
      ['Study 2026-01-02 10:15', studyUrl(P_A, STUDY_A)],
      ['#3 CT Abdomen', null],
    ]);
    expect(current()).toBe('#3 CT Abdomen');
    expect(nav().textContent).not.toMatch(UUID);
    // Each ancestor opens its own route of the real route table.
    expect(linkRoutes()).toEqual([
      ['Home', guiRoutes.home],
      ['Patients', guiRoutes.patients],
      ['Test Patient A', guiRoutes.patient],
      ['Study 2026-01-02 10:15', guiRoutes.patientStudy],
    ]);
  });

  it('every breadcrumb navigates to its page (never legacy/404), with Back and Forward', () => {
    const app = setup(seriesUrl(P_A, STUDY_A, SERIES_A));
    const { path } = app;

    click('Study 2026-01-02 10:15');
    expect(path()).toBe(studyUrl(P_A, STUDY_A));
    expect(current()).toBe('Study 2026-01-02 10:15');

    click('Test Patient A');
    expect(path()).toBe('/patients/test-patient-a');
    expect(current()).toBe('Test Patient A');

    click('Patients');
    expect(path()).toBe('/patients');
    expect(current()).toBe('Patients');
    expect(screen.queryByText(/legacy page|not found/)).toBeNull();

    app.navigate(-1);
    expect(path()).toBe('/patients/test-patient-a');
    expect(current()).toBe('Test Patient A');
    app.navigate(-1);
    expect(current()).toBe('Study 2026-01-02 10:15');
    app.navigate(1);
    expect(current()).toBe('Test Patient A');

    click('Home');
    expect(screen.getByText('home page')).toBeTruthy();
  });

  it('loading metadata: generic labels, no link without the patient slug, no ids', () => {
    mockPending = new Set([P_A, SERIES_A]);
    setup(seriesUrl(P_A, STUDY_A, SERIES_A));
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Patient', null],
      // Not linked from URL params: only once the Series confirmed its Study.
      ['Study', null],
      ['Series', null],
    ]);
    expect(current()).toBe('Series');
  });

  it('missing metadata: an unknown patient and a Study without a date', () => {
    setup(studyUrl('00000000-0000-4000-8000-000000000000', STUDY_B));
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Patient', null],
      ['Study Unknown date', null],
    ]);
    expect(nav().textContent).not.toMatch(UUID);
  });

  it('Series page uses the slug of the Series when the patient name is not loaded', () => {
    mockPending = new Set([P_A]);
    setup(seriesUrl(P_A, STUDY_A, SERIES_A));
    expect(crumbs()[2]).toEqual(['Patient', '/patients/test-patient-a']);
  });

  it('switching patients never shows the previous patient while the next loads', () => {
    const app = setup('/patients/test-patient-a');
    expect(current()).toBe('Test Patient A');
    mockPending = new Set(['test-patient-b']);
    app.navigate('/patients/test-patient-b');
    expect(current()).toBe('Patient');
    expect(nav().textContent).not.toContain('Test Patient A');
  });

  it('switching Studies and patients never shows the previous ones while loading', () => {
    const app = setup(studyUrl(P_A, STUDY_A));
    expect(current()).toBe('Study 2026-01-02 10:15');

    mockPending = new Set([STUDY_A2]);
    app.navigate(studyUrl(P_A, STUDY_A2));
    expect(current()).toBe('Study');
    mockPending = new Set();
    app.navigate(studyUrl(P_A, STUDY_A2));
    expect(current()).toBe('Study 2026-03-04 10:15');

    mockPending = new Set([P_B, STUDY_B]);
    app.navigate(studyUrl(P_B, STUDY_B));
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Patient', null],
      ['Study', null],
    ]);
  });

  it('Series deep link with an invalid patient id: no request, no ancestor links', () => {
    setup(seriesUrl('not-a-patient-id', STUDY_A, SERIES_A));
    expect(mockPatientQueryIds).toEqual([]);
    expect(crumbs()).toEqual([
      ['Home', '/'],
      ['Patients', '/patients'],
      ['Patient', null],
      ['Study', null],
      ['Series', null],
    ]);
  });

  it("Patient A / Study X -> Patient B / Study X: never A's Study metadata", () => {
    const app = setup(studyUrl(P_A, STUDY_A));
    expect(current()).toBe('Study 2026-01-02 10:15');
    // The same Study id under another patient: RTK `data` is still A's.
    mockPending = new Set([P_B, `${P_B}/${STUDY_A}`]);
    app.navigate(studyUrl(P_B, STUDY_A));
    expect(current()).toBe('Study');
    expect(nav().textContent).not.toMatch(/2026-01-02|Test Patient A/);
  });
});
