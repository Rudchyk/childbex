/**
 * The Series page: the viewer gets only the non-broken images, through the
 * authenticated API, in API order; the slice list selects (checkboxes, by
 * image id, never navigating) independently of the active slice; bulk
 * votes go to the Series endpoint in one request; Complete review is
 * possible only for a single simple stack once every presented image was
 * loaded. Unsupported series are not displayed at all.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  PatientSeriesResponse,
  SeriesImage,
  SeriesSummary,
} from '@libs/schemas';
import { Component as SeriesPage, SeriesContent } from './SeriesPage';

type ViewerProps = {
  list: string[];
  getRequestHeaders?: () => Promise<Record<string, string>>;
  onCurrentItemChange: (
    source: string | undefined,
    position?: { index: number; loadedCount: number }
  ) => void;
  onLoadResult: (result: {
    sliceCount: number;
    errorCount: number;
    loadedSources: string[];
  }) => void;
  renderSidebar?: (props: {
    items: { imageUid: string; source: string; index: number }[];
    currentImageId?: string;
    jumpTo: (index: number) => void;
  }) => unknown;
};
let mockViewerProps: ViewerProps | undefined;
/** Viewer instances mounted so far (a remount loads the images again). */
let mockViewerMounts = 0;
let mockCurrentUid: string | undefined;
let mockParams: { patientId?: string; seriesId?: string } = {};
let mockSeriesQuery: {
  currentData?: PatientSeriesResponse;
  isFetching: boolean;
  isError: boolean;
  error?: unknown;
} = { isFetching: false, isError: false };
/** Renders the real review panel (vote form) instead of a stand-in. */
let mockRealReviewPanel = false;
const mockAddVote = jest.fn();
const mockJumpTo = jest.fn();
const mockComplete = jest.fn();
const mockBulk = jest.fn();
const mockNotifyError = jest.fn();
const mockNotifySuccess = jest.fn();

jest.mock('../../components', () => ({
  // The viewer stand-in renders the slice list it is given (slice i = list[i]).
  DicomViewer: (props: ViewerProps) => {
    mockViewerProps = props;
    require('react').useEffect(() => {
      mockViewerMounts++;
    }, []);
    return (
      <div>
        viewer
        {props.renderSidebar?.({
          items: props.list.map((source, index) => ({ imageUid: `uid-${index}`, source, index })),
          currentImageId: mockCurrentUid,
          jumpTo: mockJumpTo,
        }) as never}
      </div>
    );
  },
  DialogAreYouSure: ({
    open,
    onAgree,
    children,
  }: {
    open: boolean;
    onAgree: () => void;
    children?: unknown;
  }) =>
    open ? (
      <div>
        {children as never}
        <button onClick={onAgree}>Agree</button>
      </div>
    ) : null,
}));
jest.mock('../../store/apis', () => ({
  apiBaseUrl: '/api/v1',
  useCompleteSeriesReviewMutation: () => [mockComplete, { isLoading: false }],
  useBulkReviewVoteMutation: () => [mockBulk, { isLoading: false }],
  useGetPatientSeriesQuery: () => mockSeriesQuery,
  // The real review panel's vote form (when rendered).
  useAddPatientImageReviewVoteMutation: () => [mockAddVote, { isLoading: false }],
  useUpdatePatientImageReviewVoteMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => mockParams,
}));
jest.mock('../../layouts', () => ({
  DefaultLayout: ({ children }: { children?: unknown }) => <>{children as never}</>,
}));
jest.mock('../../templates', () => ({
  PageTmpl: ({ children }: { children?: unknown }) => <>{children as never}</>,
}));
jest.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ userId: 'sub-me', isDoctor: true, isAdmin: false }),
}));
jest.mock('../../modules/archiveUpload/httpTransport', () => ({
  keycloakAuthHeaders: async () => ({ authorization: 'Bearer t' }),
}));
jest.mock('../../modules/notifications', () => ({
  useNotifications: () => ({ notifyError: mockNotifyError, notifySuccess: mockNotifySuccess }),
}));
jest.mock('./LLMCheckItems', () => ({ LLMCheckItems: () => null }));
jest.mock('./review/PatientImageReview', () => {
  const actual = jest.requireActual('./review/PatientImageReview');
  return {
    PatientImageReview: (props: { item: { id: string }; targetLabel?: string }) =>
      mockRealReviewPanel ? (
        <actual.PatientImageReview {...props} />
      ) : (
        <div data-testid="review-panel" data-target-label={props.targetLabel}>
          review:{props.item.id}
        </div>
      ),
  };
});
jest.mock('./review/PatientImageVotes', () => ({ PatientImageVotes: () => null }));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const SERIES = '55555555-5555-4555-8555-555555555555';
const summary = { total: 3, broken: 1, notReviewed: 2, normal: 0, abnormal: 0, uncertain: 0, conflicted: 0 };

const image = (id: string, overrides: Partial<SeriesImage> = {}): SeriesImage => ({
  id,
  fileUrl: `/patients/${PATIENT}/images/${id}/file`,
  instanceNumber: 1,
  orientationGroup: 0,
  isBroken: false,
  brokenReason: null,
  reviewState: 'NOT_REVIEWED' as SeriesImage['reviewState'],
  reviewStateSource: 'NONE' as SeriesImage['reviewStateSource'],
  status: 'not_reviewed' as SeriesImage['status'],
  isAbnormal: false,
  votesCount: 0,
  normalVotes: 0,
  abnormalVotes: 0,
  uncertainVotes: 0,
  adminResolutionId: null,
  adminResolutionName: null,
  resolutionComment: null,
  resolvedAt: null,
  votes: [],
  implicitNormals: [],
  ...overrides,
});

const vote = (reviewerId: string, value: 'normal' | 'abnormal' | 'uncertain') => ({
  id: `v-${reviewerId}-${value}`,
  patientImageId: 'x',
  reviewerId,
  reviewerName: reviewerId,
  vote: value as SeriesImage['votes'][number]['vote'],
  comment: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const response = (
  series: Partial<SeriesSummary> = {},
  review: PatientSeriesResponse['review'] = { imageSetRevision: 'rev', completions: [] }
): PatientSeriesResponse => ({
  patient: { id: PATIENT, slug: 'synthetic' },
  study: { id: '44444444-4444-4444-8444-444444444444', studyDate: '2026-01-02', studyTime: null },
  series: {
    id: SERIES,
    studyId: '44444444-4444-4444-8444-444444444444',
    seriesNumber: 2,
    seriesDescription: 'AXIAL',
    modality: 'CT',
    imageType: null,
    convolutionKernel: null,
    sliceThickness: null,
    imageCount: 4,
    review: summary,
    orientationCount: 1,
    multiFrameImageCount: 0,
    geometryCount: 1,
    geometryIncompleteCount: 0,
    reviewable: true,
    ...series,
  },
  // API order (second before first on purpose): the viewer keeps it.
  images: [
    image('i2', { instanceNumber: 2, votes: [vote('sub-me', 'abnormal')] }),
    image('i1', {
      instanceNumber: 1,
      reviewState: 'CONFLICTED' as SeriesImage['reviewState'],
      votes: [vote('sub-other', 'abnormal')],
      implicitNormals: [{ reviewerId: 'sub-me', reviewerName: 'Me', completedAt: '2026-10-01T00:00:00.000Z' }],
    }),
    image('i3', { instanceNumber: 3 }),
    image('broken', { isBroken: true, orientationGroup: null, brokenReason: 'pixeldata_truncated' }),
  ],
  review,
});

const url = (id: string) => `/api/v1/patients/${PATIENT}/images/${id}/file`;
const renderSeries = (data: PatientSeriesResponse) =>
  render(<SeriesContent data={data} isLoading={false} isError={false} />);
const completeButton = () =>
  screen.getByRole('button', { name: /complete review/i }) as HTMLButtonElement;
/** Rows in list order (top = last slice). */
const rows = () => screen.getAllByTestId('slice-row');
const rowOf = (imageId: string) =>
  rows().find((row) => row.getAttribute('data-image-id') === imageId) as HTMLElement;
const checkboxOf = (imageId: string) => within(rowOf(imageId)).getByRole('checkbox');
/** The viewer's report of a load that shows exactly these images. */
const loadedAll = (ids: string[]) => ({
  sliceCount: ids.length,
  errorCount: 0,
  loadedSources: ids.map(url),
});
const PRESENTED = ['i2', 'i1', 'i3'];
const header = () => screen.getByTestId('review-header').textContent;

const SERIES_B = '66666666-6666-4666-8666-666666666666';
/** Another Series of the patient, with as many images as the first one shows. */
const responseB = (): PatientSeriesResponse => ({
  ...response({ id: SERIES_B }),
  images: [
    image('b1', { instanceNumber: 7 }),
    image('b2', { instanceNumber: 8 }),
    image('b3', { instanceNumber: 9 }),
  ],
});

beforeEach(() => {
  mockViewerProps = undefined;
  mockViewerMounts = 0;
  mockCurrentUid = undefined;
  mockParams = {};
  mockSeriesQuery = { isFetching: false, isError: false };
  mockRealReviewPanel = false;
  jest.clearAllMocks();
});

describe('Series page', () => {
  it('loads only non-broken images, through the authenticated API, in API order', async () => {
    renderSeries(response());
    expect(mockViewerProps?.list).toEqual([url('i2'), url('i1'), url('i3')]);
    expect(mockViewerProps?.list.join()).not.toContain('/uploads');
    await expect(mockViewerProps?.getRequestHeaders?.()).resolves.toEqual({ authorization: 'Bearer t' });
    // The broken image is accounted for, not displayed.
    expect(screen.getByText(/1 broken image/)).toBeTruthy();
    expect(screen.getByText(/pixeldata_truncated/)).toBeTruthy();
  });

  it('shows the review panel of the current image', () => {
    renderSeries(response());
    act(() => mockViewerProps?.onCurrentItemChange(url('i1'), { index: 1, loadedCount: 3 }));
    expect(screen.getByText('review:i1')).toBeTruthy();
  });

  describe('review header', () => {
    it('names the slice on screen by its loaded position and Instance Number', () => {
      renderSeries(response());
      act(() => mockViewerProps?.onCurrentItemChange(url('i1'), { index: 1, loadedCount: 3 }));
      expect(header()).toBe('Review — Slice 2 / 3 loaded · Instance #1');
      // The vote form gets the same image and label.
      expect(screen.getByTestId('review-panel').textContent).toBe('review:i1');
      expect(screen.getByTestId('review-panel').getAttribute('data-target-label')).toBe(
        'Slice 2 / 3 loaded · Instance #1'
      );
      // No patient identifiers.
      expect(header()).not.toContain('synthetic');
      expect(header()).not.toContain(PATIENT);
    });

    it('follows wheel scrolling and navigation from the slice list', () => {
      renderSeries(response());
      // Wheel scrolling: the viewer reports each slice on screen.
      act(() => mockViewerProps?.onCurrentItemChange(url('i2'), { index: 0, loadedCount: 3 }));
      expect(header()).toBe('Review — Slice 1 / 3 loaded · Instance #2');
      act(() => mockViewerProps?.onCurrentItemChange(url('i1'), { index: 1, loadedCount: 3 }));
      expect(header()).toBe('Review — Slice 2 / 3 loaded · Instance #1');

      // The list asks the viewer to jump; the viewer then reports the slice.
      fireEvent.click(screen.getByRole('button', { name: /Show Slice 3/ }));
      expect(mockJumpTo).toHaveBeenCalledWith(2);
      act(() => mockViewerProps?.onCurrentItemChange(url('i3'), { index: 2, loadedCount: 3 }));
      expect(header()).toBe('Review — Slice 3 / 3 loaded · Instance #3');
      expect(screen.getByText('review:i3')).toBeTruthy();
    });

    it('says when the Instance Number is missing', () => {
      const data = response();
      data.images[0] = { ...data.images[0], instanceNumber: null };
      renderSeries(data);
      act(() => mockViewerProps?.onCurrentItemChange(url('i2'), { index: 0, loadedCount: 3 }));
      expect(header()).toBe('Review — Slice 1 / 3 loaded · no Instance #');
    });

    it('shows no vote form while the slice on screen is not resolved', () => {
      renderSeries(response());
      expect(header()).toBe('Review — no slice shown yet');

      // Known image, position in the loaded volume not known yet.
      act(() => mockViewerProps?.onCurrentItemChange(url('i1')));
      expect(header()).toBe('Review — locating the slice on screen…');
      expect(screen.queryByTestId('review-panel')).toBeNull();

      // Not an image of this Series.
      act(() =>
        mockViewerProps?.onCurrentItemChange('/api/v1/patients/x/images/other/file', {
          index: 0,
          loadedCount: 3,
        })
      );
      expect(header()).toBe('Review — no slice shown yet');
      expect(screen.queryByTestId('review-panel')).toBeNull();
    });

    it('positions are in the loaded volume and a partial load is flagged', () => {
      renderSeries(response());
      act(() => mockViewerProps?.onCurrentItemChange(url('i3'), { index: 1, loadedCount: 2 }));
      expect(header()).toBe('Review — Slice 2 / 2 loaded · Instance #3');
      expect(screen.getByText(/Only 2 of 3 images\s+of this series are loaded/)).toBeTruthy();
    });
  });

  describe('slice list', () => {
    it("lists every presented slice by image id with the doctor's own opinion", () => {
      renderSeries(response());
      // Top = last slice (viewer index 2).
      expect(rows().map((row) => row.getAttribute('data-image-id'))).toEqual(['i3', 'i1', 'i2']);
      expect(within(rowOf('i2')).getByLabelText('Your opinion: Abnormal')).toBeTruthy();
      expect(
        within(rowOf('i1')).getByLabelText('Your opinion: Normal (implicit, from your completed review)')
      ).toBeTruthy();
      expect(within(rowOf('i1')).getByLabelText('Conflict')).toBeTruthy();
      expect(within(rowOf('i3')).queryByLabelText(/Your opinion/)).toBeNull();
    });

    it('a checkbox selects without navigating; a row navigates without selecting', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i1'));
      expect(mockJumpTo).not.toHaveBeenCalled();
      expect(rowOf('i1').getAttribute('aria-selected')).toBe('true');

      fireEvent.click(screen.getByRole('button', { name: /Show Slice 3/ }));
      expect(mockJumpTo).toHaveBeenCalledWith(2);
      expect(rowOf('i3').getAttribute('aria-selected')).toBe('false');
      expect(screen.getByTestId('selection-count').textContent).toBe('1 of 3 selected');
    });

    it('supports multiple selection, deselection, shift-ranges and select all', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i3'));
      fireEvent.click(checkboxOf('i2'));
      expect(screen.getByTestId('selection-count').textContent).toBe('2 of 3 selected');
      fireEvent.click(checkboxOf('i3')); // deselect
      expect(screen.getByTestId('selection-count').textContent).toBe('1 of 3 selected');
      fireEvent.click(checkboxOf('i2')); // deselect
      expect(screen.getByTestId('selection-count').textContent).toBe('3 slices');

      // Shift-click selects the range from the last clicked slice.
      fireEvent.click(checkboxOf('i3'));
      fireEvent.click(checkboxOf('i2'), { shiftKey: true });
      expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);

      // Select all toggles: all selected -> none -> all.
      const all = screen.getByRole('checkbox', { name: 'Select all slices' });
      fireEvent.click(all);
      expect(screen.getByTestId('selection-count').textContent).toBe('3 slices');
      fireEvent.click(all);
      expect(screen.getByTestId('selection-count').textContent).toBe('3 of 3 selected');
    });

    it('the active slice is independent of the selection', () => {
      mockCurrentUid = 'uid-1'; // viewer slice 1 = i1
      renderSeries(response());
      expect(screen.getByRole('button', { name: /Show Slice 2/ }).getAttribute('aria-current')).toBe('true');
      fireEvent.click(checkboxOf('i3'));
      expect(screen.getByRole('button', { name: /Show Slice 2/ }).getAttribute('aria-current')).toBe('true');
      expect(rowOf('i1').getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('bulk votes', () => {
    it.each([
      ['Normal', 'normal'],
      ['Abnormal', 'abnormal'],
      ['Not sure', 'uncertain'],
    ])('%s: one request with the selected image ids; then the selection is cleared', async (label, value) => {
      mockBulk.mockReturnValue({
        unwrap: () => Promise.resolve({ requested: 2, created: 1, changed: 1, unchanged: 0 }),
      });
      renderSeries(response());
      expect(screen.queryByTestId('bulk-review-actions')).toBeNull();
      fireEvent.click(checkboxOf('i3'));
      fireEvent.click(checkboxOf('i1'));
      fireEvent.click(within(screen.getByTestId('bulk-review-actions')).getByRole('button', { name: label }));

      expect(mockBulk).toHaveBeenCalledTimes(1);
      expect(mockBulk).toHaveBeenCalledWith({
        patientId: PATIENT,
        seriesId: SERIES,
        imageIds: ['i3', 'i1'],
        vote: value,
      });
      await waitFor(() => expect(screen.getByTestId('selection-count').textContent).toBe('3 slices'));
      expect(mockNotifySuccess).toHaveBeenCalled();
      expect(mockJumpTo).not.toHaveBeenCalled(); // the viewer position is kept
    });

    it('a failed bulk vote is reported and keeps the selection for a retry', async () => {
      const error = { status: 409, data: { code: 'REVIEW_LOCKED', message: 'locked for a moment' } };
      mockBulk.mockReturnValue({ unwrap: () => Promise.reject(error) });
      renderSeries(response());
      fireEvent.click(checkboxOf('i2'));
      fireEvent.click(screen.getByRole('button', { name: 'Abnormal' }));
      await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith(error));
      expect(mockNotifySuccess).not.toHaveBeenCalled();
      expect(screen.getByTestId('selection-count').textContent).toBe('1 of 3 selected');
    });
  });

  describe('complete review', () => {
    it('is enabled only after every presented image was loaded', () => {
      renderSeries(response());
      expect(completeButton().disabled).toBe(true);
      act(() => mockViewerProps?.onLoadResult(loadedAll(['i2', 'i1'])));
      expect(completeButton().disabled).toBe(true);
      act(() => mockViewerProps?.onLoadResult({ ...loadedAll(PRESENTED), errorCount: 1 }));
      expect(completeButton().disabled).toBe(true);
      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      expect(completeButton().disabled).toBe(false);
    });

    it.each([
      ['images of another Series', loadedAll(['b1', 'b2', 'b3'])],
      ['an image twice and one missing', loadedAll(['i2', 'i1', 'i1'])],
      ['slices whose source is unknown', { ...loadedAll(['i2', 'i1']), sliceCount: 3 }],
      ['a load error', { ...loadedAll(PRESENTED), errorCount: 1 }],
      ['a partial load', { ...loadedAll(['i2']), errorCount: 1 }],
      ['no stack that could be displayed', { ...loadedAll([]), errorCount: 3 }],
    ])('stays disabled when the viewer shows %s, even with the right slice count', (_, result) => {
      renderSeries(response());
      act(() => mockViewerProps?.onLoadResult(result));
      expect(completeButton().disabled).toBe(true);
      expect(completeButton().parentElement?.getAttribute('aria-label')).toBe(
        'Not every image of the series could be shown'
      );
    });

    it('explains the normal-by-default meaning and calls the Series endpoint with the presented images', () => {
      mockComplete.mockReturnValue({ unwrap: () => new Promise(() => undefined) });
      renderSeries(response());
      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      fireEvent.click(completeButton());
      expect(screen.getByText(/1 Abnormal, 0 Not sure, 0 Normal/)).toBeTruthy();
      expect(screen.getByText(/other 2 image\(s\) will count as Normal/)).toBeTruthy();
      expect(screen.getByText(/can still\s+change any of your decisions later/)).toBeTruthy();
      fireEvent.click(screen.getByText('Agree'));
      expect(mockComplete).toHaveBeenCalledWith({
        patientId: PATIENT,
        seriesId: SERIES,
        presentedImageIds: ['i2', 'i1', 'i3'],
      });
    });

    it('shows a completed review without locking anything, and an outdated one', () => {
      const completion = {
        reviewerId: 'sub-me',
        reviewerName: 'Me',
        completedAt: '2026-10-01T10:00:00.000Z',
        imageSetRevision: 'rev',
        imageCount: 3,
        current: true,
        uncoveredImageCount: 0,
      };
      const { unmount } = renderSeries(response({}, { imageSetRevision: 'rev', completions: [completion] }));
      expect(screen.getByText(/You completed this review/)).toBeTruthy();
      // Still editable: slices can be selected and voted on.
      fireEvent.click(checkboxOf('i1'));
      expect(screen.getByTestId('bulk-review-actions')).toBeTruthy();
      unmount();

      renderSeries(
        response({}, {
          imageSetRevision: 'rev-2',
          completions: [{ ...completion, current: false, uncoveredImageCount: 1 }],
        })
      );
      expect(screen.getByText(/1 new image\(s\) not reviewed/)).toBeTruthy();
    });
  });

  describe('series isolation', () => {
    it('Series A -> B with equal slice counts: new viewer, no reuse of A\'s load result', () => {
      const { rerender } = renderSeries(response());
      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      act(() => mockViewerProps?.onCurrentItemChange(url('i1'), { index: 1, loadedCount: 3 }));
      expect(completeButton().disabled).toBe(false);

      rerender(<SeriesContent data={responseB()} isLoading={false} isError={false} />);

      expect(mockViewerMounts).toBe(2);
      expect(mockViewerProps?.list).toEqual([url('b1'), url('b2'), url('b3')]);
      expect(completeButton().disabled).toBe(true);
      expect(header()).toBe('Review — no slice shown yet');
      expect(screen.queryByTestId('review-panel')).toBeNull();

      act(() => mockViewerProps?.onLoadResult(loadedAll(['b1', 'b2', 'b3'])));
      expect(completeButton().disabled).toBe(false);
    });

    it('Series A -> B while A is loading: late reports of A change nothing in B', () => {
      const { rerender } = renderSeries(response());
      const viewerA = mockViewerProps as ViewerProps;
      rerender(<SeriesContent data={responseB()} isLoading={false} isError={false} />);

      act(() => {
        viewerA.onLoadResult(loadedAll(PRESENTED));
        viewerA.onCurrentItemChange(url('i1'), { index: 1, loadedCount: 3 });
      });

      expect(completeButton().disabled).toBe(true);
      expect(header()).toBe('Review — no slice shown yet');
      expect(screen.queryByTestId('review-panel')).toBeNull();
    });

    it('a refetch of the same Series (e.g. after a vote) keeps the viewer and its state', () => {
      const { rerender } = renderSeries(response());
      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      act(() => mockViewerProps?.onCurrentItemChange(url('i3'), { index: 2, loadedCount: 3 }));

      const refetched = response();
      refetched.images[2] = { ...refetched.images[2], votes: [vote('sub-me', 'normal')] };
      rerender(<SeriesContent data={refetched} isLoading={false} isError={false} />);

      expect(mockViewerMounts).toBe(1);
      expect(completeButton().disabled).toBe(false);
      expect(header()).toBe('Review — Slice 3 / 3 loaded · Instance #3');
      expect(within(rowOf('i3')).getByLabelText('Your opinion: Normal')).toBeTruthy();
    });

    describe('route', () => {
      const renderPage = () => render(<SeriesPage />);

      it('never renders the previous Series while another one is fetched', () => {
        mockParams = { patientId: PATIENT, seriesId: SERIES };
        mockSeriesQuery = { currentData: response(), isFetching: false, isError: false };
        const { rerender } = renderPage();
        expect(mockViewerProps?.list).toEqual([url('i2'), url('i1'), url('i3')]);

        // Navigated to B: RTK Query has no current data for B yet.
        mockParams = { patientId: PATIENT, seriesId: SERIES_B };
        mockSeriesQuery = { currentData: undefined, isFetching: true, isError: false };
        mockViewerProps = undefined as ViewerProps | undefined;
        rerender(<SeriesPage />);
        expect(mockViewerProps).toBeUndefined();
        expect(screen.queryByRole('button', { name: /complete review/i })).toBeNull();
        expect(screen.getByRole('progressbar')).toBeTruthy();

        mockSeriesQuery = { currentData: responseB(), isFetching: false, isError: false };
        rerender(<SeriesPage />);
        expect(mockViewerProps?.list).toEqual([url('b1'), url('b2'), url('b3')]);
      });

      it('ignores data of another Series than the URL names', () => {
        mockParams = { patientId: PATIENT, seriesId: SERIES_B };
        mockSeriesQuery = { currentData: response(), isFetching: false, isError: false };
        renderPage();
        expect(mockViewerProps).toBeUndefined();
        expect(screen.queryByRole('button', { name: /complete review/i })).toBeNull();
      });

      it('a failed refetch after a vote keeps the Series, the slice on screen and unsaved votes', () => {
        mockRealReviewPanel = true;
        mockParams = { patientId: PATIENT, seriesId: SERIES };
        mockSeriesQuery = { currentData: response(), isFetching: false, isError: false };
        const { rerender } = renderPage();
        act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
        act(() => mockViewerProps?.onCurrentItemChange(url('i3'), { index: 2, loadedCount: 3 }));
        expect(header()).toBe('Review — Slice 3 / 3 loaded · Instance #3');
        // Unsaved choice and comment on the slice on screen.
        fireEvent.click(screen.getByRole('radio', { name: 'Abnormal' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
          target: { value: 'draft' },
        });

        // A vote elsewhere invalidated the Series: the refetch runs, then fails.
        // RTK Query keeps this Series' last data as `currentData`.
        mockSeriesQuery = { ...mockSeriesQuery, isFetching: true };
        rerender(<SeriesPage />);
        mockSeriesQuery = {
          currentData: mockSeriesQuery.currentData,
          isFetching: false,
          isError: true,
          error: { status: 503, data: { message: 'Service Unavailable.' } },
        };
        rerender(<SeriesPage />);

        expect(mockViewerMounts).toBe(1);
        expect(mockViewerProps?.list).toEqual([url('i2'), url('i1'), url('i3')]);
        expect(header()).toBe('Review — Slice 3 / 3 loaded · Instance #3');
        expect((screen.getByRole('radio', { name: 'Abnormal' }) as HTMLInputElement).checked).toBe(true);
        expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe('draft');
        expect(completeButton().disabled).toBe(false);
        // Non-destructive: a warning above the kept content.
        const warning = screen.getByTestId('series-refresh-error');
        expect(warning.textContent).toContain('could not be refreshed');
        expect(warning.textContent).toContain('Service Unavailable.');

        // The next successful refetch clears the warning, still the same viewer.
        mockSeriesQuery = { currentData: response(), isFetching: false, isError: false };
        rerender(<SeriesPage />);
        expect(screen.queryByTestId('series-refresh-error')).toBeNull();
        expect(mockViewerMounts).toBe(1);
      });

      it('an initial load error is shown instead of the Series', () => {
        mockParams = { patientId: PATIENT, seriesId: SERIES };
        mockSeriesQuery = {
          currentData: undefined,
          isFetching: false,
          isError: true,
          error: { status: 404, data: { message: 'Not found. This series does not exist.' } },
        };
        renderPage();
        expect(screen.getByText('Not found. This series does not exist.')).toBeTruthy();
        expect(screen.queryByTestId('series-refresh-error')).toBeNull();
        expect(mockViewerProps).toBeUndefined();
      });
    });
  });

  it.each([
    ['several orientations', { orientationCount: 2, reviewable: false }],
    ['a multi-frame image', { multiFrameImageCount: 1, reviewable: false }],
    ['mixed geometry', { geometryCount: 2, reviewable: false }],
    ['incomplete geometry', { geometryIncompleteCount: 1, reviewable: false }],
  ])('a series with %s is not displayed and cannot be completed', (_, series) => {
    renderSeries(response(series));
    expect(mockViewerProps).toBeUndefined();
    expect(screen.queryByRole('button', { name: /complete review/i })).toBeNull();
    expect(screen.getByText(/cannot be reviewed as a whole/)).toBeTruthy();
  });
});
