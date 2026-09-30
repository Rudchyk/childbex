/**
 * The Series page: the viewer gets only the non-broken images, through the
 * authenticated API, in API order; Finish review uses the Series endpoint
 * and is possible only for a single simple stack once every presented
 * image was loaded. Unsupported series are not displayed at all.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  sidebarItemIcon: (source: string) => unknown;
};
let mockViewerProps: ViewerProps | undefined;
const mockFinish = jest.fn();

jest.mock('../../components', () => ({
  DicomViewer: (props: ViewerProps) => {
    mockViewerProps = props;
    return <div>viewer</div>;
  },
  DialogAreYouSure: ({ open, onAgree }: { open: boolean; onAgree: () => void }) =>
    open ? <button onClick={onAgree}>Agree</button> : null,
}));
jest.mock('../../store/apis', () => ({
  apiBaseUrl: '/api/v1',
  useFinishSeriesReviewMutation: () => [mockFinish, { isLoading: false }],
}));
jest.mock('../../modules/archiveUpload/httpTransport', () => ({
  keycloakAuthHeaders: async () => ({ authorization: 'Bearer t' }),
}));
jest.mock('../../modules/notifications', () => ({
  useNotifications: () => ({ notifyError: jest.fn(), notifySuccess: jest.fn() }),
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
  ...overrides,
});

const response = (series: Partial<SeriesSummary> = {}): PatientSeriesResponse => ({
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
    imageCount: 3,
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
    image('i2'),
    image('i1', { reviewState: 'ABNORMAL' as SeriesImage['reviewState'] }),
    image('broken', { isBroken: true, orientationGroup: null, brokenReason: 'pixeldata_truncated' }),
  ],
});

const url = (id: string) => `/api/v1/patients/${PATIENT}/images/${id}/file`;
const renderSeries = (data: PatientSeriesResponse) =>
  render(<SeriesContent data={data} isLoading={false} isError={false} />);
const finishButton = () => screen.getByRole('button', { name: /finish review/i }) as HTMLButtonElement;

beforeEach(() => {
  mockViewerProps = undefined;
  jest.clearAllMocks();
});

describe('Series page', () => {
  it('loads only non-broken images, through the authenticated API, in API order', async () => {
    renderSeries(response());
    expect(mockViewerProps?.list).toEqual([url('i2'), url('i1')]);
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
    expect(() => mockViewerProps?.sidebarItemIcon(url('i1'))).not.toThrow();
  });

  it('enables Finish review only after every presented image was loaded', () => {
    renderSeries(response());
    expect(finishButton().disabled).toBe(true);
    act(() => mockViewerProps?.onLoadResult({ sliceCount: 1, errorCount: 0 }));
    expect(finishButton().disabled).toBe(true);
    act(() => mockViewerProps?.onLoadResult({ sliceCount: 2, errorCount: 1 }));
    expect(finishButton().disabled).toBe(true);
    act(() => mockViewerProps?.onLoadResult({ sliceCount: 2, errorCount: 0 }));
    expect(finishButton().disabled).toBe(false);
  });

  it('Finish review calls the Series endpoint with exactly the presented images', () => {
    renderSeries(response());
    act(() => mockViewerProps?.onLoadResult({ sliceCount: 2, errorCount: 0 }));
    fireEvent.click(finishButton());
    fireEvent.click(screen.getByText('Agree'));
    expect(mockFinish).toHaveBeenCalledWith({
      patientId: PATIENT,
      seriesId: SERIES,
      presentedImageIds: ['i2', 'i1'],
    });
  });

  it.each([
    ['several orientations', { orientationCount: 2, reviewable: false }],
    ['a multi-frame image', { multiFrameImageCount: 1, reviewable: false }],
    ['mixed geometry', { geometryCount: 2, reviewable: false }],
    ['incomplete geometry', { geometryIncompleteCount: 1, reviewable: false }],
  ])('a series with %s is not displayed and cannot be finished', (_, series) => {
    renderSeries(response(series));
    expect(mockViewerProps).toBeUndefined();
    expect(screen.queryByRole('button', { name: /finish review/i })).toBeNull();
    expect(screen.getByText(/cannot be reviewed as a whole/)).toBeTruthy();
  });
});
