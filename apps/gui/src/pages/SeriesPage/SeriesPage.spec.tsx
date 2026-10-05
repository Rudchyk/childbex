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
import { SeriesContent } from './SeriesPage';

type ViewerProps = {
  list: string[];
  getRequestHeaders?: () => Promise<Record<string, string>>;
  onCurrentItemChange: (source: string) => void;
  onLoadResult: (result: { sliceCount: number; errorCount: number }) => void;
  renderSidebar?: (props: {
    items: { imageUid: string; source: string; index: number }[];
    currentImageId?: string;
    jumpTo: (index: number) => void;
  }) => unknown;
};
let mockViewerProps: ViewerProps | undefined;
let mockCurrentUid: string | undefined;
const mockJumpTo = jest.fn();
const mockComplete = jest.fn();
const mockBulk = jest.fn();
const mockNotifyError = jest.fn();
const mockNotifySuccess = jest.fn();

jest.mock('../../components', () => ({
  // The viewer stand-in renders the slice list it is given (slice i = list[i]).
  DicomViewer: (props: ViewerProps) => {
    mockViewerProps = props;
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
jest.mock('./review/PatientImageReview', () => ({
  PatientImageReview: ({ item }: { item: { id: string } }) => <div>review:{item.id}</div>,
}));

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

beforeEach(() => {
  mockViewerProps = undefined;
  mockCurrentUid = undefined;
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
    act(() => mockViewerProps?.onCurrentItemChange(url('i1')));
    expect(screen.getByText('review:i1')).toBeTruthy();
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
      act(() => mockViewerProps?.onLoadResult({ sliceCount: 2, errorCount: 0 }));
      expect(completeButton().disabled).toBe(true);
      act(() => mockViewerProps?.onLoadResult({ sliceCount: 3, errorCount: 1 }));
      expect(completeButton().disabled).toBe(true);
      act(() => mockViewerProps?.onLoadResult({ sliceCount: 3, errorCount: 0 }));
      expect(completeButton().disabled).toBe(false);
    });

    it('explains the normal-by-default meaning and calls the Series endpoint with the presented images', () => {
      mockComplete.mockReturnValue({ unwrap: () => new Promise(() => undefined) });
      renderSeries(response());
      act(() => mockViewerProps?.onLoadResult({ sliceCount: 3, errorCount: 0 }));
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
