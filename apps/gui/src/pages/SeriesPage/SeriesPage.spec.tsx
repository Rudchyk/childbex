/**
 * The Series page: the viewer gets only the non-broken images, through the
 * authenticated API, in API order; the slice list selects (checkboxes, by
 * image id; a checkbox click also asks the viewer for that slice)
 * independently of the active slice, which is only ever the slice the
 * viewer reports on screen; bulk votes go to the Series endpoint in one
 * request and never navigate; Complete review is
 * possible only for a single simple stack once every presented image was
 * loaded. Unsupported series are not displayed at all.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  PatientSeriesResponse,
  SeriesImage,
  SeriesSummary,
} from '@libs/schemas';
import { createTheme } from '@mui/material';
import { format } from 'date-fns';
import { defaultDateFormat } from '@libs/constants';
import { Component as SeriesPage, SeriesContent } from './SeriesPage';
import {
  REVIEW_PANEL_WIDTH,
  SIDE_BY_SIDE_BREAKPOINT,
  SLICE_PANEL_WIDTH,
} from './SeriesImages';

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
  sidebarPlacement?: 'beside' | 'below';
  leadingPanel?: unknown;
};
let mockViewerProps: ViewerProps | undefined;
/** Viewer instances mounted so far (a remount loads the images again). */
let mockViewerMounts = 0;
let mockCurrentUid: string | undefined;
/** Slices the viewer stand-in reports (default: every list entry). */
let mockViewerItems: { imageUid: string; source: string; index: number }[] | undefined;
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
        {props.leadingPanel as never}
        viewer
        {props.renderSidebar?.({
          items:
            mockViewerItems ??
            props.list.map((source, index) => ({ imageUid: `uid-${index}`, source, index })),
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
  useGetPatientQuery: () => ({ currentData: undefined }),
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
  mockViewerItems = undefined;
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
      expect(within(rowOf('i1')).getByLabelText(/^All reviewers: Conflicted/)).toBeTruthy();
      expect(within(rowOf('i3')).queryByLabelText(/Your opinion/)).toBeNull();
    });

    // Issue #38 supersedes #13's "a checkbox never navigates": a checkbox
    // click selects and asks the viewer for that slice; a row still only
    // navigates; selected and active stay separate states.
    it('a checkbox selects and asks once for its slice; a row navigates without selecting', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i1'));
      expect(rowOf('i1').getAttribute('aria-selected')).toBe('true');
      expect(mockJumpTo).toHaveBeenCalledTimes(1);
      expect(mockJumpTo).toHaveBeenCalledWith(1); // i1 is viewer slice 1

      mockJumpTo.mockClear();
      fireEvent.click(screen.getByRole('button', { name: /Show Slice 3/ }));
      expect(mockJumpTo).toHaveBeenCalledTimes(1);
      expect(mockJumpTo).toHaveBeenCalledWith(2);
      expect(rowOf('i3').getAttribute('aria-selected')).toBe('false');
      expect(screen.getByTestId('selection-count').textContent).toBe('1 of 3 selected');
    });

    it('unchecking a slice still asks once for it and keeps the other selections and votes', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i2'));
      fireEvent.click(checkboxOf('i3'));
      mockJumpTo.mockClear();

      fireEvent.click(checkboxOf('i3')); // deselect
      expect(rowOf('i3').getAttribute('aria-selected')).toBe('false');
      expect(rowOf('i2').getAttribute('aria-selected')).toBe('true');
      expect(mockJumpTo).toHaveBeenCalledTimes(1);
      expect(mockJumpTo).toHaveBeenCalledWith(2);
      // Navigation and selection never vote.
      expect(mockAddVote).not.toHaveBeenCalled();
      expect(mockBulk).not.toHaveBeenCalled();
      expect(within(rowOf('i2')).getByLabelText('Your opinion: Abnormal')).toBeTruthy();
    });

    it('a shift-click range navigates once, to the clicked slice only (select and deselect)', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i3')); // anchor (viewer slice 2)
      mockJumpTo.mockClear();
      fireEvent.click(checkboxOf('i2'), { shiftKey: true }); // viewer slice 0
      expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);
      expect(mockJumpTo.mock.calls).toEqual([[0]]);

      // Deselecting a range: the same semantics, one jump to the target.
      fireEvent.click(checkboxOf('i3')); // deselect, anchor
      mockJumpTo.mockClear();
      fireEvent.click(checkboxOf('i1'), { shiftKey: true }); // viewer slice 1
      expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
      expect(mockJumpTo.mock.calls).toEqual([[1]]);
    });

    it('Select all changes the selection without navigating', () => {
      renderSeries(response());
      const all = screen.getByRole('checkbox', { name: 'Select all slices' });
      fireEvent.click(all);
      expect(screen.getByTestId('selection-count').textContent).toBe('3 of 3 selected');
      fireEvent.click(all);
      expect(screen.getByTestId('selection-count').textContent).toBe('3 slices');
      expect(mockJumpTo).not.toHaveBeenCalled();
    });

    it('a checkbox works from the keyboard (Space clicks the focused box)', () => {
      renderSeries(response());
      const box = checkboxOf('i3');
      box.focus();
      expect(document.activeElement).toBe(box);
      // What the browser does on Space: a click on the focused checkbox.
      act(() => box.click());
      expect(rowOf('i3').getAttribute('aria-selected')).toBe('true');
      expect(mockJumpTo.mock.calls).toEqual([[2]]);
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

  describe('active slice', () => {
    /** dwv shows viewer slice `index` (slice i = list[i] = PRESENTED[i]). */
    const viewerShows = (index: number) =>
      act(() => {
        mockCurrentUid = `uid-${index}`;
        mockViewerProps?.onCurrentItemChange(url(PRESENTED[index]), { index, loadedCount: 3 });
      });
    const activeIds = () =>
      rows()
        .filter((row) => row.getAttribute('data-active') === 'true')
        .map((row) => row.getAttribute('data-image-id'));
    const currentButtons = () =>
      screen.queryAllByRole('button', { name: /^Show Slice/ }).filter(
        (button) => button.getAttribute('aria-current') === 'true'
      );

    it('follows the slice dwv reports (wheel, keyboard), never changing the selection', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i3'));
      viewerShows(0);
      expect(activeIds()).toEqual(['i2']);
      viewerShows(1);
      expect(activeIds()).toEqual(['i1']);
      expect(within(rowOf('i1')).getByTestId('active-slice-marker')).toBeTruthy();
      expect(within(rowOf('i2')).queryByTestId('active-slice-marker')).toBeNull();
      expect(currentButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
        'Show Slice 2 · #1',
      ]);
      expect(screen.getByTestId('selection-count').textContent).toBe('1 of 3 selected');
    });

    it('moves to a checked slice only once dwv shows it', () => {
      renderSeries(response());
      viewerShows(0);
      fireEvent.click(checkboxOf('i3'));
      expect(mockJumpTo.mock.calls).toEqual([[2]]);
      // Asked for, not shown yet: the highlight stays on the slice on screen.
      expect(activeIds()).toEqual(['i2']);

      viewerShows(2);
      expect(activeIds()).toEqual(['i3']);
      // Active and selected at once.
      expect(rowOf('i3').getAttribute('aria-selected')).toBe('true');
    });

    it('when dwv shows another slice than asked for, only that one is active', () => {
      renderSeries(response());
      viewerShows(1);
      fireEvent.click(checkboxOf('i3')); // asks for slice 2
      viewerShows(0); // dwv reports slice 0 instead
      expect(activeIds()).toEqual(['i2']);
      expect(currentButtons()).toHaveLength(1);
    });

    it('keeps the opinion and conflict marks on an active, selected slice', () => {
      renderSeries(response());
      fireEvent.click(checkboxOf('i1'));
      viewerShows(1);
      const row = rowOf('i1');
      expect(row.getAttribute('data-active')).toBe('true');
      expect(row.getAttribute('aria-selected')).toBe('true');
      expect(within(row).getByLabelText(/^All reviewers: Conflicted/)).toBeTruthy();
      expect(
        within(row).getByLabelText('Your opinion: Normal (implicit, from your completed review)')
      ).toBeTruthy();
      expect(within(rowOf('i2')).getByLabelText('Your opinion: Abnormal')).toBeTruthy();
    });

    it('highlights nothing while the slice on screen is unknown or not a listed slice', () => {
      // Nothing reported yet.
      renderSeries(response());
      expect(activeIds()).toEqual([]);
      expect(currentButtons()).toEqual([]);
    });

    it('highlights nothing for an image the viewer has not mapped to a source', () => {
      // The slice on screen has no known file (not one of this Series).
      mockViewerItems = [
        { imageUid: 'uid-0', source: url('i2'), index: 0 },
        { imageUid: 'uid-1', source: url('i1'), index: 1 },
        { imageUid: 'uid-x', source: '/api/v1/patients/x/images/other/file', index: 2 },
      ];
      mockCurrentUid = 'uid-x';
      const { rerender } = renderSeries(response());
      expect(rows().map((row) => row.getAttribute('data-image-id'))).toEqual(['i1', 'i2']);
      expect(activeIds()).toEqual([]);

      // A UID the viewer never listed (e.g. not loaded).
      mockCurrentUid = 'uid-missing';
      rerender(<SeriesContent data={response()} isLoading={false} isError={false} />);
      fireEvent.click(checkboxOf('i1'));
      expect(mockJumpTo.mock.calls).toEqual([[1]]);
      expect(activeIds()).toEqual([]);
      expect(currentButtons()).toEqual([]);
    });

    it('while loading there is no list to click; a partial load navigates by dwv index', () => {
      mockViewerItems = [];
      const { rerender } = renderSeries(response());
      expect(screen.getByText('No slices loaded yet.')).toBeTruthy();
      expect(screen.queryAllByRole('checkbox', { name: /^Select Slice/ })).toEqual([]);

      // Two of three loaded, in another order than the API's.
      mockViewerItems = [
        { imageUid: 'uid-a', source: url('i3'), index: 0 },
        { imageUid: 'uid-b', source: url('i2'), index: 1 },
      ];
      rerender(<SeriesContent data={response()} isLoading={false} isError={false} />);
      fireEvent.click(checkboxOf('i3'));
      expect(mockJumpTo.mock.calls).toEqual([[0]]);
      expect(activeIds()).toEqual([]);
      expect(completeButton().disabled).toBe(true);
    });

    it('another Series starts without the previous active slice', () => {
      const { rerender } = renderSeries(response());
      viewerShows(1);
      expect(activeIds()).toEqual(['i1']);

      // The new viewer has not reported a slice yet.
      mockCurrentUid = undefined;
      rerender(<SeriesContent data={responseB()} isLoading={false} isError={false} />);
      expect(rows().map((row) => row.getAttribute('data-image-id'))).toEqual(['b3', 'b2', 'b1']);
      expect(activeIds()).toEqual([]);
      expect(currentButtons()).toEqual([]);
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
      // Each checkbox asked for its slice; the bulk vote asks for none.
      expect(mockJumpTo.mock.calls).toEqual([[2], [1]]);
      mockJumpTo.mockClear();
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

    it('a failed bulk vote does not navigate either', async () => {
      mockBulk.mockReturnValue({ unwrap: () => Promise.reject({ status: 500 }) });
      renderSeries(response());
      fireEvent.click(checkboxOf('i2'));
      mockJumpTo.mockClear();
      fireEvent.click(screen.getByRole('button', { name: 'Normal' }));
      await waitFor(() => expect(mockNotifyError).toHaveBeenCalled());
      expect(mockJumpTo).not.toHaveBeenCalled();
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

    it('is neither enabled by a selection nor navigates', () => {
      mockComplete.mockReturnValue({ unwrap: () => new Promise(() => undefined) });
      renderSeries(response());
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all slices' }));
      expect(completeButton().disabled).toBe(true);

      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      fireEvent.click(completeButton());
      fireEvent.click(screen.getByText('Agree'));
      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockJumpTo).not.toHaveBeenCalled();
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

  describe('collapsible side panels', () => {
    const toggle = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
    const reviewToggle = () => toggle(/review panel$/);
    const sliceToggle = () => toggle(/slice list$/);
    const reviewContent = () => document.getElementById('series-review-panel') as HTMLElement;
    const sliceContent = () => document.getElementById('series-slice-list') as HTMLElement;
    /** Expanded: the toggle says so and the content it controls is shown. */
    const expectPanel = (button: HTMLButtonElement, content: HTMLElement, expanded: boolean) => {
      expect(button.getAttribute('aria-expanded')).toBe(String(expanded));
      expect(button.getAttribute('aria-controls')).toBe(content.id);
      expect(content.hidden).toBe(!expanded);
    };

    it('the review panel collapses and restores without changing the slice list', () => {
      renderSeries(response());
      expect(reviewToggle().getAttribute('aria-label')).toBe('Hide review panel');
      expectPanel(reviewToggle(), reviewContent(), true);

      fireEvent.click(reviewToggle());
      expect(reviewToggle().getAttribute('aria-label')).toBe('Show review panel');
      expectPanel(reviewToggle(), reviewContent(), false);
      expectPanel(sliceToggle(), sliceContent(), true);

      fireEvent.click(reviewToggle());
      expectPanel(reviewToggle(), reviewContent(), true);
      expectPanel(sliceToggle(), sliceContent(), true);
    });

    it('the slice list collapses and restores without changing the review panel', () => {
      renderSeries(response());
      expect(sliceToggle().getAttribute('aria-label')).toBe('Hide slice list');

      fireEvent.click(sliceToggle());
      expect(sliceToggle().getAttribute('aria-label')).toBe('Show slice list');
      expectPanel(sliceToggle(), sliceContent(), false);
      expectPanel(reviewToggle(), reviewContent(), true);

      fireEvent.click(sliceToggle());
      expectPanel(sliceToggle(), sliceContent(), true);
      expectPanel(reviewToggle(), reviewContent(), true);
    });

    it('both panels can be collapsed; their restore controls stay usable', () => {
      renderSeries(response());
      fireEvent.click(reviewToggle());
      fireEvent.click(sliceToggle());
      expectPanel(reviewToggle(), reviewContent(), false);
      expectPanel(sliceToggle(), sliceContent(), false);
      // The restore controls are outside the hidden content.
      expect(reviewContent().contains(reviewToggle())).toBe(false);
      expect(sliceContent().contains(sliceToggle())).toBe(false);

      fireEvent.click(sliceToggle());
      expectPanel(sliceToggle(), sliceContent(), true);
      expectPanel(reviewToggle(), reviewContent(), false);
      fireEvent.click(reviewToggle());
      expectPanel(reviewToggle(), reviewContent(), true);
    });

    it('the toggle is a native button that keeps keyboard focus across states', async () => {
      renderSeries(response());
      const button = reviewToggle();
      expect(button.tagName).toBe('BUTTON');
      // Async: MUI starts the focus ripple after the focus event.
      await act(async () => button.focus());
      fireEvent.click(button);
      // The same element, still focused (focus never lands in hidden content).
      expect(reviewToggle()).toBe(button);
      expect(document.activeElement).toBe(button);
      fireEvent.click(button);
      expect(document.activeElement).toBe(button);
    });

    it("keeps the reviewer's unsaved input, the slice on screen and the viewer", () => {
      mockRealReviewPanel = true;
      renderSeries(response());
      const list = mockViewerProps?.list;
      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      act(() => mockViewerProps?.onCurrentItemChange(url('i3'), { index: 2, loadedCount: 3 }));
      fireEvent.click(screen.getByRole('radio', { name: 'Abnormal' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
        target: { value: 'draft' },
      });
      const form = screen.getByRole('textbox', { name: 'Comment' });

      fireEvent.click(reviewToggle());
      fireEvent.click(sliceToggle());
      fireEvent.click(reviewToggle());
      fireEvent.click(sliceToggle());

      // The same (never remounted) form, with the unsaved choice and comment.
      expect(screen.getByRole('textbox', { name: 'Comment' })).toBe(form);
      expect((form as HTMLTextAreaElement).value).toBe('draft');
      expect((screen.getByRole('radio', { name: 'Abnormal' }) as HTMLInputElement).checked).toBe(true);
      expect(mockAddVote).not.toHaveBeenCalled();
      expect(header()).toBe('Review — Slice 3 / 3 loaded · Instance #3');
      // One viewer, its image list unchanged: nothing is loaded again.
      expect(mockViewerMounts).toBe(1);
      expect(mockViewerProps?.list).toBe(list);
      expect(mockJumpTo).not.toHaveBeenCalled();
    });

    it('keeps the slice selection, the active slice and the bulk actions', () => {
      mockCurrentUid = 'uid-1'; // viewer slice 1 = i1
      renderSeries(response());
      fireEvent.click(checkboxOf('i3'));
      fireEvent.click(checkboxOf('i2'));
      // Requests only: the viewer still shows slice 1.
      expect(mockJumpTo.mock.calls).toEqual([[2], [0]]);
      mockJumpTo.mockClear();
      const list = screen.getByRole('list', { name: 'Series slices' });

      fireEvent.click(sliceToggle());
      expect(sliceContent().hidden).toBe(true);
      fireEvent.click(reviewToggle());
      fireEvent.click(sliceToggle());

      expect(screen.getByRole('list', { name: 'Series slices' })).toBe(list);
      expect(screen.getByTestId('selection-count').textContent).toBe('2 of 3 selected');
      expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['true', 'false', 'true']);
      expect(screen.getByRole('button', { name: /Show Slice 2/ }).getAttribute('aria-current')).toBe('true');
      expect(rows().map((row) => row.getAttribute('data-active'))).toEqual(['false', 'true', 'false']);
      expect(within(rowOf('i1')).getByTestId('active-slice-marker')).toBeTruthy();
      expect(screen.getByTestId('bulk-review-actions')).toBeTruthy();
      expect(mockJumpTo).not.toHaveBeenCalled();
      expect(mockViewerMounts).toBe(1);
    });

    it('leaves the Complete review safety checks unchanged', () => {
      renderSeries(response());
      fireEvent.click(reviewToggle());
      fireEvent.click(sliceToggle());
      // Not loaded yet: still disabled with the panels collapsed.
      expect(completeButton().disabled).toBe(true);
      act(() => mockViewerProps?.onLoadResult(loadedAll(['i2', 'i1'])));
      expect(completeButton().disabled).toBe(true);

      fireEvent.click(reviewToggle());
      act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
      expect(completeButton().disabled).toBe(false);
      fireEvent.click(sliceToggle());
      fireEvent.click(reviewToggle());
      expect(completeButton().disabled).toBe(false);
    });

    it('opens another Series with both panels expanded (state is per Series)', () => {
      const { rerender } = renderSeries(response());
      fireEvent.click(reviewToggle());
      fireEvent.click(sliceToggle());
      rerender(<SeriesContent data={responseB()} isLoading={false} isError={false} />);
      expectPanel(reviewToggle(), reviewContent(), true);
      expectPanel(sliceToggle(), sliceContent(), true);
    });

    it('offers the slice list with its toggle while nothing is loaded yet', () => {
      mockViewerItems = [];
      renderSeries(response());
      expect(screen.getByText('No slices loaded yet.')).toBeTruthy();
      fireEvent.click(sliceToggle());
      expectPanel(sliceToggle(), sliceContent(), false);
    });

    describe('responsive layout', () => {
      /**
       * jsdom has no layout engine: the window width only drives media
       * queries (min-/max-width), which decide the layout. Real pixel sizes
       * are checked in a browser.
       */
      let windowWidth = 1920;
      const mediaListeners = new Set<() => void>();
      const matchesWidth = (query: string) => {
        const features = [...query.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)];
        return (
          features.length > 0 &&
          features.every(([, kind, px]) =>
            kind === 'min' ? windowWidth >= Number(px) : windowWidth <= Number(px)
          )
        );
      };
      const resizeWindow = (width: number) => {
        windowWidth = width;
        act(() => mediaListeners.forEach((listener) => listener()));
      };
      const originalMatchMedia = window.matchMedia;
      beforeEach(() => {
        windowWidth = 1920;
        mediaListeners.clear();
        window.matchMedia = ((query: string) => ({
          get matches() {
            return matchesWidth(query);
          },
          media: query,
          addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
          removeEventListener: (_: string, listener: () => void) =>
            mediaListeners.delete(listener),
          addListener: (listener: () => void) => mediaListeners.add(listener),
          removeListener: (listener: () => void) => mediaListeners.delete(listener),
        })) as never;
      });
      afterEach(() => {
        window.matchMedia = originalMatchMedia;
      });
      const workspace = () => screen.getByTestId('series-review-workspace');
      const panel = (id: string) => screen.getByTestId(`${id}-panel`);
      const expectPanelWidth = (id: string, width: string) =>
        expect(getComputedStyle(panel(id)).width).toBe(width);

      it('collapsed side by side, both panels are the same rail', () => {
        renderSeries(response());
        fireEvent.click(reviewToggle());
        fireEvent.click(sliceToggle());
        const [left, right] = ['series-review-panel', 'series-slice-list'].map(panel);
        const style = (element: HTMLElement) => {
          const computed = getComputedStyle(element);
          return {
            width: computed.width,
            height: computed.height,
            display: computed.display,
            flexDirection: computed.flexDirection,
            overflow: computed.overflow,
            borderRadius: computed.borderRadius,
            boxShadow: computed.boxShadow,
          };
        };
        expect(style(left)).toEqual(style(right));
        expect(style(left).width).toBe('40px');
        // Neither sets its own height: both are as high as the viewer's row.
        expect(style(left).height).toBe('');
        expect(left.className.replace(/css-S+/g, '')).toBe(right.className.replace(/css-S+/g, ''));
        // The same structure: the toggle on top, then the vertical title.
        for (const element of [left, right]) {
          const header = element.firstElementChild as HTMLElement;
          expect(getComputedStyle(header).flexDirection).toBe('column');
          expect(header.firstElementChild?.tagName).toBe('BUTTON');
          expect(getComputedStyle(header.lastElementChild as HTMLElement).writingMode).toBe('vertical-rl');
        }
        // Only the chevrons differ: each points back to the viewer.
        expect(reviewToggle().querySelector('[data-testid="ChevronRightIcon"]')).toBeTruthy();
        expect(sliceToggle().querySelector('[data-testid="ChevronLeftIcon"]')).toBeTruthy();

        // One collapsed, one expanded: the collapsed one is the same rail.
        fireEvent.click(sliceToggle());
        expectPanelWidth('series-review-panel', '40px');
        expectPanelWidth('series-slice-list', '270px');
        fireEvent.click(reviewToggle());
        fireEvent.click(sliceToggle());
        expectPanelWidth('series-review-panel', '300px');
        expectPanelWidth('series-slice-list', '40px');
      });

      it('expanded side by side, both panels fill the row and scroll their content', () => {
        renderSeries(response());
        for (const id of ['series-review-panel', 'series-slice-list']) {
          expect(getComputedStyle(panel(id)).height).toBe('');
          const content = screen.getByTestId(`${id}-content`);
          expect(getComputedStyle(content).position).toBe('absolute');
          expect(getComputedStyle(content).overflow).toBe('auto');
        }
      });

      it('stacked, the review form keeps its own height; the slice list is bounded', () => {
        windowWidth = 768;
        renderSeries(response());
        expect(getComputedStyle(screen.getByTestId('series-review-panel-content')).position).not.toBe(
          'absolute'
        );
        expect(getComputedStyle(panel('series-slice-list')).height).toBe('60vh');
        fireEvent.click(sliceToggle());
        expect(getComputedStyle(panel('series-slice-list')).height).toBe('');
      });

      it.each([
        [375, 'stacked', 'below'],
        [600, 'stacked', 'below'],
        [768, 'stacked', 'below'],
        [1024, 'stacked', 'below'],
        [1199, 'stacked', 'below'],
        [1200, 'side', 'beside'],
        [1366, 'side', 'beside'],
        [1920, 'side', 'beside'],
      ])('at %ipx: panels %s, slice list %s the viewport; both toggles work', (width, layout, placement) => {
        windowWidth = width;
        renderSeries(response());
        expect(workspace().getAttribute('data-layout')).toBe(layout);
        expect(screen.getByTestId('series-review-panel-panel').getAttribute('data-layout')).toBe(layout);
        expect(screen.getByTestId('series-slice-list-panel').getAttribute('data-layout')).toBe(layout);
        expect(mockViewerProps?.sidebarPlacement).toBe(placement);
        // Both panels go to the viewer, on its two sides (or below it).
        expect(screen.getByTestId('series-review-panel-panel')).toBeTruthy();
        expectPanelWidth('series-review-panel', layout === 'side' ? '300px' : '100%');
        expectPanelWidth('series-slice-list', layout === 'side' ? '270px' : '100%');

        fireEvent.click(reviewToggle());
        expectPanel(reviewToggle(), reviewContent(), false);
        expectPanel(sliceToggle(), sliceContent(), true);
        fireEvent.click(sliceToggle());
        expectPanel(sliceToggle(), sliceContent(), false);
        fireEvent.click(reviewToggle());
        fireEvent.click(sliceToggle());
        expectPanel(reviewToggle(), reviewContent(), true);
        expectPanel(sliceToggle(), sliceContent(), true);
      });

      it('side by side only where both expanded panels leave the image a usable width', () => {
        const theme = createTheme();
        const narrowest = theme.breakpoints.values[SIDE_BY_SIDE_BREAKPOINT];
        // Page gutters (Container, 24px each side) and the two 8px gaps.
        const viewport = narrowest - 2 * 24 - REVIEW_PANEL_WIDTH - SLICE_PANEL_WIDTH - 2 * 8;
        expect(viewport).toBeGreaterThanOrEqual(500);
      });

      it('crossing the breakpoint keeps every panel, the viewer and the review state', () => {
        mockRealReviewPanel = true;
        mockCurrentUid = 'uid-2';
        windowWidth = 1366;
        renderSeries(response());
        const list = mockViewerProps?.list;
        act(() => mockViewerProps?.onLoadResult(loadedAll(PRESENTED)));
        act(() => mockViewerProps?.onCurrentItemChange(url('i3'), { index: 2, loadedCount: 3 }));
        fireEvent.click(screen.getByRole('radio', { name: 'Abnormal' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
          target: { value: 'draft' },
        });
        fireEvent.click(checkboxOf('i1'));
        // The checkbox asked for slice 1; the viewer did not show it.
        expect(mockJumpTo.mock.calls).toEqual([[1]]);
        mockJumpTo.mockClear();
        fireEvent.click(sliceToggle());
        const form = screen.getByRole('textbox', { name: 'Comment' });
        // Collapsed: hidden from the accessibility tree, still mounted.
        const sliceList = screen.getByRole('list', { name: 'Series slices', hidden: true });
        const toggles = [reviewToggle(), sliceToggle()];

        for (const width of [768, 375, 1920, 1024]) {
          resizeWindow(width);
          expect(workspace().getAttribute('data-layout')).toBe(width >= 1200 ? 'side' : 'stacked');
          // The same elements (nothing remounted), with their state.
          expect(screen.getByRole('textbox', { name: 'Comment' })).toBe(form);
          expect((form as HTMLTextAreaElement).value).toBe('draft');
          expect((screen.getByRole('radio', { name: 'Abnormal' }) as HTMLInputElement).checked).toBe(true);
          expect(screen.getByRole('list', { name: 'Series slices', hidden: true })).toBe(sliceList);
          expect(screen.getByTestId('selection-count').textContent).toBe('1 of 3 selected');
          expect(
            screen.getByRole('button', { name: /Show Slice 3/, hidden: true }).getAttribute('aria-current')
          ).toBe('true');
          expect([reviewToggle(), sliceToggle()]).toEqual(toggles);
          // Panel states are kept too.
          expectPanel(reviewToggle(), reviewContent(), true);
          expectPanel(sliceToggle(), sliceContent(), false);
          expect(header()).toBe('Review — Slice 3 / 3 loaded · Instance #3');
          expect(completeButton().disabled).toBe(false);
        }
        expect(mockViewerMounts).toBe(1);
        expect(mockViewerProps?.list).toBe(list);
        expect(mockJumpTo).not.toHaveBeenCalled();
        expect(mockAddVote).not.toHaveBeenCalled();
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

/**
 * Issue #43: the slice list shows every slice's aggregate review state (all
 * reviewers, canonical backend state) apart from the current doctor's own
 * opinion, with filters and counts over the Series' images by image id.
 * The current doctor is `sub-me`; `sub-a` is another doctor.
 */
describe('aggregate review state in the slice list', () => {
  const state = (value: string) => value as SeriesImage['reviewState'];
  const source = (value: string) => value as SeriesImage['reviewStateSource'];
  const reviewed = (id: string, overrides: Partial<SeriesImage>) =>
    image(id, { instanceNumber: Number(id.slice(1)), ...overrides });
  /** API order = viewer order: a1 is viewer slice 0 … a7 viewer slice 6. */
  const reviewedResponse = (): PatientSeriesResponse => ({
    ...response(),
    images: [
      // Doctor A voted Abnormal; the current doctor has no opinion.
      reviewed('a1', { reviewState: state('ABNORMAL'), reviewStateSource: source('VOTES'),
        votes: [vote('sub-a', 'abnormal')], isAbnormal: true, abnormalVotes: 1, votesCount: 1 }),
      // Doctor A Abnormal, the current doctor explicitly Normal.
      reviewed('a2', { reviewState: state('CONFLICTED'), reviewStateSource: source('VOTES'),
        votes: [vote('sub-a', 'abnormal'), vote('sub-me', 'normal')] }),
      reviewed('a3', { reviewState: state('UNCERTAIN'), reviewStateSource: source('VOTES'),
        votes: [vote('sub-a', 'uncertain')] }),
      // The current doctor's implicit Normal (completed review).
      reviewed('a4', { reviewState: state('NORMAL'), reviewStateSource: source('FINISH_REVIEW'),
        implicitNormals: [{ reviewerId: 'sub-me', reviewerName: 'Me', completedAt: '2026-10-01T00:00:00.000Z' }] }),
      reviewed('a5', {}),
      reviewed('a6', { reviewState: state('ABNORMAL'), reviewStateSource: source('RESOLUTION'),
        adminResolutionId: 'admin', adminResolutionName: 'Admin' }),
      reviewed('a7', { reviewState: state('ABNORMAL'), reviewStateSource: source('VOTES'),
        votes: [vote('sub-a', 'abnormal')] }),
    ],
  });
  const markOf = (id: string) => within(rowOf(id)).getByTestId('aggregate-mark');
  const listedIds = () => screen.queryAllByTestId('slice-row').map((row) => row.getAttribute('data-image-id'));
  const filterBar = () => screen.getByTestId('slice-review-filter');
  const filterChip = (name: RegExp) => within(filterBar()).getByRole('button', { name });
  const chipLabels = () => within(filterBar()).getAllByRole('button').map((chip) => chip.textContent);
  const notLoaded = () => screen.queryByTestId('slice-filter-not-loaded')?.textContent;

  it("Doctor B sees Doctor A's Abnormal without an own vote, apart from own opinions", () => {
    renderSeries(reviewedResponse());
    expect(markOf('a1').textContent).toBe('ABN');
    expect(within(rowOf('a1')).queryByLabelText(/^Your opinion/)).toBeNull();

    expect(markOf('a2').textContent).toBe('CONF');
    expect(within(rowOf('a2')).getByLabelText('Your opinion: Normal')).toBeTruthy();

    expect(markOf('a3').textContent).toBe('UNSURE');
    expect(markOf('a4').textContent).toBe('NORM');
    expect(
      within(rowOf('a4')).getByLabelText('Your opinion: Normal (implicit, from your completed review)')
    ).toBeTruthy();
    expect(markOf('a5').textContent).toBe('—');
    expect(markOf('a6').getAttribute('data-resolved')).toBe('true');
    expect(markOf('a6').getAttribute('aria-label')).toBe('All reviewers: Abnormal — set by an admin resolution');
  });

  it('counts per filter and lists only the matching slices, by image id', () => {
    renderSeries(reviewedResponse());
    expect(chipLabels()).toEqual(['All 7', 'Abnormal 3', 'Conflicted 1', 'Not sure 1']);
    expect(filterChip(/^All/).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(filterChip(/^Abnormal/));
    expect(filterChip(/^Abnormal/).getAttribute('aria-pressed')).toBe('true');
    expect(listedIds()).toEqual(['a7', 'a6', 'a1']);
    // A filtered row still navigates to its own viewer slice.
    fireEvent.click(within(rowOf('a6')).getByRole('button', { name: /^Show Slice 6/ }));
    expect(mockJumpTo.mock.calls).toEqual([[5]]);

    fireEvent.click(filterChip(/^Conflicted/));
    expect(listedIds()).toEqual(['a2']);
    fireEvent.click(filterChip(/^Not sure/));
    expect(listedIds()).toEqual(['a3']);
    fireEvent.click(filterChip(/^All/));
    expect(listedIds()).toEqual(['a7', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1']);
  });

  it('a filter clears the selection; bulk votes cover only the shown, selected slices', async () => {
    mockBulk.mockReturnValue({
      unwrap: () => Promise.resolve({ requested: 3, created: 3, changed: 0, unchanged: 0 }),
    });
    renderSeries(reviewedResponse());
    fireEvent.click(checkboxOf('a5'));
    expect(screen.getByTestId('selection-count').textContent).toBe('1 of 7 selected');

    fireEvent.click(filterChip(/^Abnormal/));
    expect(screen.getByTestId('selection-count').textContent).toBe('3 slices');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all slices' }));
    expect(screen.getByTestId('selection-count').textContent).toBe('3 of 3 selected');
    fireEvent.click(within(screen.getByTestId('bulk-review-actions')).getByRole('button', { name: 'Abnormal' }));
    expect(mockBulk).toHaveBeenCalledWith({
      patientId: PATIENT,
      seriesId: SERIES,
      imageIds: ['a7', 'a6', 'a1'],
      vote: 'abnormal',
    });
    await waitFor(() => expect(screen.getByTestId('selection-count').textContent).toBe('3 slices'));
  });

  it('says when no loaded slice matches a filter', () => {
    renderSeries(response()); // i1 conflicted, nothing Not sure
    fireEvent.click(filterChip(/^Not sure/));
    expect(listedIds()).toEqual([]);
    expect(screen.getByTestId('slice-list-empty').textContent).toBe(
      'No slices in “Not sure” among the 3 loaded.'
    );
  });

  it('counts slices not loaded yet, lists and navigates only loaded ones', () => {
    // The viewer has loaded a2 and a1 only (its own order).
    mockViewerItems = [
      { imageUid: 'uid-x', source: url('a2'), index: 0 },
      { imageUid: 'uid-y', source: url('a1'), index: 1 },
    ];
    renderSeries(reviewedResponse());
    expect(chipLabels()).toEqual(['All 7', 'Abnormal 3', 'Conflicted 1', 'Not sure 1']);
    expect(notLoaded()).toBe('2 of 7 slices loaded in the viewer; the others are listed once loaded.');

    fireEvent.click(filterChip(/^Abnormal/));
    expect(listedIds()).toEqual(['a1']);
    expect(notLoaded()).toBe(
      '1 of 3 Abnormal slices loaded in the viewer; the others are listed once loaded.'
    );
    // a1 is slice 1 of the loaded volume (not its API position).
    fireEvent.click(checkboxOf('a1'));
    expect(mockJumpTo.mock.calls).toEqual([[1]]);

    fireEvent.click(filterChip(/^Conflicted/));
    expect(listedIds()).toEqual(['a2']);
    expect(notLoaded()).toBeUndefined();
  });

  it('before any slice is loaded, shows the counts and no slice to open', () => {
    mockViewerItems = [];
    renderSeries(reviewedResponse());
    expect(chipLabels()).toEqual(['All 7', 'Abnormal 3', 'Conflicted 1', 'Not sure 1']);
    expect(screen.getByText('No slices loaded yet.')).toBeTruthy();
    expect(listedIds()).toEqual([]);
    expect(notLoaded()).toBe('0 of 7 slices loaded in the viewer; the others are listed once loaded.');
  });

  it('updates marks and counts after votes, bulk votes and Complete review, keeping the viewer', () => {
    mockCurrentUid = 'uid-4'; // viewer slice 4 = a5
    const { rerender } = renderSeries(reviewedResponse());
    act(() => mockViewerProps?.onCurrentItemChange(url('a5'), { index: 4, loadedCount: 7 }));
    fireEvent.click(filterChip(/^Abnormal/));
    expect(listedIds()).toEqual(['a7', 'a6', 'a1']);

    // The own vote on a5 and another one on a1 were saved: refetched.
    const afterVote = reviewedResponse();
    afterVote.images[4] = { ...afterVote.images[4], reviewState: state('ABNORMAL'),
      reviewStateSource: source('VOTES'), votes: [vote('sub-me', 'abnormal')] };
    afterVote.images[0] = { ...afterVote.images[0], reviewState: state('CONFLICTED'),
      votes: [vote('sub-a', 'abnormal'), vote('sub-me', 'normal')] };
    rerender(<SeriesContent data={afterVote} isLoading={false} isError={false} />);
    expect(chipLabels()).toEqual(['All 7', 'Abnormal 3', 'Conflicted 2', 'Not sure 1']);
    expect(listedIds()).toEqual(['a7', 'a6', 'a5']);
    expect(markOf('a5').textContent).toBe('ABN');
    expect(within(rowOf('a5')).getByLabelText('Your opinion: Abnormal')).toBeTruthy();
    expect(rowOf('a5').getAttribute('data-active')).toBe('true');

    // A bulk vote turned a6 and a7 into conflicts; a Complete review gave
    // a3 an implicit Normal (conflict with the Not sure vote).
    const afterBulk = {
      ...afterVote,
      images: afterVote.images.map((item) =>
        ['a6', 'a7'].includes(item.id)
          ? { ...item, reviewState: state('CONFLICTED'), reviewStateSource: source('VOTES') }
          : item.id === 'a3'
            ? {
                ...item,
                reviewState: state('CONFLICTED'),
                implicitNormals: [
                  { reviewerId: 'sub-me', reviewerName: 'Me', completedAt: '2026-10-02T00:00:00.000Z' },
                ],
              }
            : item
      ),
    };
    rerender(<SeriesContent data={afterBulk} isLoading={false} isError={false} />);
    expect(chipLabels()).toEqual(['All 7', 'Abnormal 1', 'Conflicted 5', 'Not sure 0']);
    expect(listedIds()).toEqual(['a5']);
    fireEvent.click(filterChip(/^Conflicted/));
    expect(listedIds()).toEqual(['a7', 'a6', 'a3', 'a2', 'a1']);

    // Same Series: never reloaded, the slice on screen is kept.
    expect(mockViewerMounts).toBe(1);
    expect(header()).toBe('Review — Slice 5 / 7 loaded · Instance #5');
  });

  it("switching Series shows only the new Series' states, with the filter reset", () => {
    const { rerender } = renderSeries(reviewedResponse());
    fireEvent.click(filterChip(/^Abnormal/));
    expect(listedIds()).toEqual(['a7', 'a6', 'a1']);

    rerender(<SeriesContent data={responseB()} isLoading={false} isError={false} />);
    expect(filterChip(/^All/).getAttribute('aria-pressed')).toBe('true');
    expect(chipLabels()).toEqual(['All 3', 'Abnormal 0', 'Conflicted 0', 'Not sure 0']);
    expect(listedIds()).toEqual(['b3', 'b2', 'b1']);
    expect(screen.getAllByTestId('aggregate-mark').map((mark) => mark.textContent)).toEqual(['—', '—', '—']);
  });

  it('a Series of 361 slices: counts and filtered rows map to the right images', () => {
    const many: PatientSeriesResponse = {
      ...response(),
      images: Array.from({ length: 361 }, (_, index) =>
        image(`s${index}`, {
          instanceNumber: index + 1,
          ...(index % 50 === 0
            ? { reviewState: state('ABNORMAL'), reviewStateSource: source('VOTES'), votes: [vote('sub-a', 'abnormal')] }
            : {}),
        })
      ),
    };
    renderSeries(many);
    expect(chipLabels()).toEqual(['All 361', 'Abnormal 8', 'Conflicted 0', 'Not sure 0']);
    // Virtualised: only some of the 361 rows are mounted.
    expect(rows().length).toBeLessThan(60);

    fireEvent.click(filterChip(/^Abnormal/));
    expect(listedIds()).toEqual(['s350', 's300', 's250', 's200', 's150', 's100', 's50', 's0']);
    expect(rows().every((row) => row.getAttribute('data-review-state') === 'ABNORMAL')).toBe(true);
    fireEvent.click(within(rowOf('s250')).getByRole('button', { name: 'Show Slice 251 · #251' }));
    expect(mockJumpTo.mock.calls).toEqual([[250]]);
  });
});

describe('reviewer progress (#44)', () => {
  type Completion = PatientSeriesResponse['review']['completions'][number];
  const named = (reviewerId: string, reviewerName: string, value: 'normal' | 'abnormal' | 'uncertain') => ({
    ...vote(reviewerId, value),
    reviewerName,
  });
  const done = (reviewerId: string, reviewerName: string, overrides: Partial<Completion> = {}): Completion => ({
    reviewerId,
    reviewerName,
    completedAt: '2026-10-02T10:00:00.000Z',
    imageSetRevision: 'rev',
    imageCount: 3,
    current: true,
    uncoveredImageCount: 0,
    ...overrides,
  });
  /** The signed-in doctor is `sub-me` (Doctor B). */
  const withReviews = (
    completions: Completion[],
    votesByImage: Record<string, SeriesImage['votes']> = {}
  ): PatientSeriesResponse => {
    const base = response({}, { imageSetRevision: 'rev', completions });
    return {
      ...base,
      images: base.images.map((item) => ({ ...item, votes: votesByImage[item.id] ?? [], implicitNormals: [] })),
    };
  };
  const progress = () => screen.getByTestId('review-progress');
  const reviewerRows = () => within(progress()).queryAllByTestId('reviewer-progress');
  const rowOfReviewer = (id: string) =>
    reviewerRows().find((row) => row.getAttribute('data-reviewer-id') === id) as HTMLElement;
  const statuses = () =>
    reviewerRows().map((row) => [row.getAttribute('data-reviewer-id'), row.getAttribute('data-status')]);
  const summaryText = () => within(progress()).queryByTestId('review-progress-summary')?.textContent;
  const at = (iso: string) => format(iso, defaultDateFormat);

  it("Doctor B sees Doctor A's completed review; B's own review stays separate and not completed", () => {
    renderSeries(withReviews([done('sub-a', 'Doctor A')], { i2: [named('sub-me', 'Doctor B', 'abnormal')] }));
    expect(within(progress()).getByRole('heading', { name: 'Review progress' })).toBeTruthy();
    expect(within(progress()).getByRole('list', { name: 'Reviewers of this series' })).toBeTruthy();
    expect(statuses()).toEqual([
      ['sub-me', 'notCompleted'],
      ['sub-a', 'completed'],
    ]);
    expect(rowOfReviewer('sub-me').textContent).toBe(
      'Your review · Doctor BNot completed1 image marked, review not completed'
    );
    expect(rowOfReviewer('sub-a').textContent).toBe(
      `Doctor ACompletedCompleted ${at('2026-10-02T10:00:00.000Z')} · covers the current images`
    );
    // A's completion is not B's: B's own Complete review is unchanged.
    expect(completeButton().textContent).toBe('Complete review');
    expect(screen.queryByText(/You completed this review/)).toBeNull();
    expect(summaryText()).toBe('1 current completion · 1 not completed');
  });

  it('three reviewers: one current, one stale with its uncovered images, one voter without completion', () => {
    renderSeries(
      withReviews(
        [
          done('sub-a', 'Doctor A'),
          done('sub-c', 'Doctor C', { current: false, imageSetRevision: 'old', uncoveredImageCount: 2 }),
        ],
        { i1: [named('sub-d', 'Doctor D', 'uncertain')], i3: [named('sub-d', 'Doctor D', 'normal')] }
      )
    );
    expect(statuses()).toEqual([
      ['sub-a', 'completed'],
      ['sub-c', 'needsRecompletion'],
      ['sub-d', 'notCompleted'],
    ]);
    expect(within(rowOfReviewer('sub-c')).getByText('Needs recompletion')).toBeTruthy();
    expect(within(rowOfReviewer('sub-c')).getByText(/2 new images not covered$/)).toBeTruthy();
    expect(within(rowOfReviewer('sub-d')).getByText('2 images marked, review not completed')).toBeTruthy();
    // The stale completion is not counted as a current one; no roster.
    expect(summaryText()).toBe('1 current completion · 1 needs recompletion · 1 not completed');
    expect(within(progress()).getByTestId('review-progress-known').textContent).toBe(
      '3 known reviewers (voted or completed). Not a list of assigned reviewers.'
    );
    expect(progress().textContent).not.toMatch(/of 3|\/ ?3/);
    // The signed-in doctor has no activity: said, but not counted.
    expect(within(progress()).getByText('You have not marked or completed this series yet.')).toBeTruthy();
  });

  it('no reviewer activity yet', () => {
    renderSeries(withReviews([]));
    expect(reviewerRows()).toEqual([]);
    expect(within(progress()).getByTestId('review-progress-empty').textContent).toBe('No reviewer activity yet.');
    expect(summaryText()).toBeUndefined();
  });

  it('missing reviewer names fall back to a label, never the reviewer id', () => {
    renderSeries(withReviews([done('sub-nameless-1', '')], { i3: [named('sub-nameless-2', ' ', 'abnormal')] }));
    expect(within(progress()).getAllByText('Unnamed reviewer')).toHaveLength(2);
    expect(progress().textContent).not.toContain('sub-nameless');
  });

  it('after refetches: recompletion, a vote after completion (no Reopen) and new images', () => {
    const { rerender } = renderSeries(
      withReviews(
        [done('sub-me', 'Doctor B', { current: false, uncoveredImageCount: 1 }), done('sub-a', 'Doctor A')],
        { i1: [named('sub-a', 'Doctor A', 'abnormal')] }
      )
    );
    expect(statuses()).toEqual([
      ['sub-me', 'needsRecompletion'],
      ['sub-a', 'completed'],
    ]);
    expect(within(rowOfReviewer('sub-me')).getByText(/1 new image not covered$/)).toBeTruthy();
    // The new image is not Normal by default from the old completion.
    expect(within(rowOf('i3')).queryByLabelText(/^Your opinion/)).toBeNull();
    expect(completeButton().textContent).toBe('Complete review');
    const doctorA = rowOfReviewer('sub-a').textContent;

    // Recompleted (refetched): current again, with its new date.
    const recompleted = withReviews(
      [done('sub-me', 'Doctor B', { completedAt: '2026-10-03T08:00:00.000Z' }), done('sub-a', 'Doctor A')],
      { i1: [named('sub-a', 'Doctor A', 'abnormal')] }
    );
    rerender(<SeriesContent data={recompleted} isLoading={false} isError={false} />);
    expect(statuses()).toEqual([
      ['sub-me', 'completed'],
      ['sub-a', 'completed'],
    ]);
    expect(rowOfReviewer('sub-me').textContent).toContain(at('2026-10-03T08:00:00.000Z'));
    expect(summaryText()).toBe('2 current completions');

    // An own vote after completion: still completed and editable, A untouched.
    const voted = withReviews(recompleted.review.completions, {
      i1: [named('sub-a', 'Doctor A', 'abnormal')],
      i2: [named('sub-me', 'Doctor B', 'abnormal')],
    });
    rerender(<SeriesContent data={voted} isLoading={false} isError={false} />);
    expect(statuses()).toEqual([
      ['sub-me', 'completed'],
      ['sub-a', 'completed'],
    ]);
    expect(rowOfReviewer('sub-a').textContent).toBe(doctorA);
    expect(screen.queryByRole('button', { name: /reopen/i })).toBeNull();
    fireEvent.click(checkboxOf('i1'));
    expect(screen.getByTestId('bulk-review-actions')).toBeTruthy();
    // Same Series: the viewer is kept.
    expect(mockViewerMounts).toBe(1);
  });

  it("switching Series or patient shows only the new Series' reviewers", () => {
    const { rerender } = renderSeries(
      withReviews([done('sub-a', 'Doctor A')], { i2: [named('sub-me', 'Doctor B', 'abnormal')] })
    );
    expect(reviewerRows()).toHaveLength(2);

    rerender(<SeriesContent data={responseB()} isLoading={false} isError={false} />);
    expect(reviewerRows()).toEqual([]);
    expect(within(progress()).getByTestId('review-progress-empty')).toBeTruthy();
    expect(progress().textContent).not.toContain('Doctor A');

    const otherPatient: PatientSeriesResponse = {
      ...responseB(),
      patient: { id: '22222222-2222-4222-8222-222222222222', slug: 'synthetic-2' },
      images: [image('c1', { votes: [named('sub-e', 'Doctor E', 'normal')] })],
    };
    rerender(<SeriesContent data={otherPatient} isLoading={false} isError={false} />);
    expect(statuses()).toEqual([['sub-e', 'notCompleted']]);
  });

  it('leaves the #43 aggregate slice marks and filters in place', () => {
    const data = withReviews([done('sub-a', 'Doctor A')], { i1: [named('sub-a', 'Doctor A', 'abnormal')] });
    data.images = data.images.map((item) =>
      item.id === 'i1'
        ? {
            ...item,
            reviewState: 'ABNORMAL' as SeriesImage['reviewState'],
            reviewStateSource: 'VOTES' as SeriesImage['reviewStateSource'],
          }
        : item
    );
    renderSeries(data);
    expect(within(rowOf('i1')).getByTestId('aggregate-mark').textContent).toBe('ABN');
    fireEvent.click(within(screen.getByTestId('slice-review-filter')).getByRole('button', { name: /^Abnormal/ }));
    expect(rows().map((row) => row.getAttribute('data-image-id'))).toEqual(['i1']);
    expect(statuses()).toEqual([['sub-a', 'completed']]);
  });
});
