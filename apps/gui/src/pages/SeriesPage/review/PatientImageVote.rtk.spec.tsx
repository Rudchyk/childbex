/**
 * The review panel's vote form with real RTK Query: createApi, store,
 * middleware and mutation hooks (fixedCacheKey, unwrap). Only the network is
 * faked: a base query that records each request and answers when the test
 * says so.
 *
 * The app's `apiStore` cannot be loaded under Jest (it reads
 * `import.meta.env`), so its two vote endpoints are declared here exactly as
 * there: same routes, methods, bodies and invalidated tag.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { createApi, type BaseQueryFn } from '@reduxjs/toolkit/query/react';
import { Provider } from 'react-redux';
import { generatePath } from 'react-router-dom';
import { apiRoutes } from '@libs/constants';
import type {
  IDProperty,
  PatientImageReviewVoteParams,
  PatientImageReviewVoteRequestBody,
} from '@libs/schemas';
import { PatientImageReview, type ReviewPanelImage } from './PatientImageReview';

type Request = { url: string; method: string; body: unknown };
/** Requests sent to the (fake) server, each answered by the test. */
const mockNetwork: {
  request: Request;
  succeed: () => void;
  fail: (status: number, message: string) => void;
}[] = [];

const fakeBaseQuery: BaseQueryFn<Request, unknown, { status: number; data: { message: string } }> = (
  request
) =>
  new Promise((resolve) => {
    mockNetwork.push({
      request,
      succeed: () => resolve({ data: null }),
      fail: (status, message) => resolve({ error: { status, data: { message } } }),
    });
  });

const mockApi = createApi({
  reducerPath: 'apiStore',
  baseQuery: fakeBaseQuery,
  tagTypes: ['patient'],
  endpoints: (builder) => ({
    addPatientImageReviewVote: builder.mutation<
      void,
      IDProperty & PatientImageReviewVoteRequestBody
    >({
      query: ({ id, ...body }) => ({
        url: generatePath(apiRoutes.patientImagesReviewsVotes, { id }),
        method: 'POST',
        body,
      }),
      invalidatesTags: ['patient'],
    }),
    updatePatientImageReviewVote: builder.mutation<
      void,
      PatientImageReviewVoteParams & PatientImageReviewVoteRequestBody
    >({
      query: ({ id, voteId, ...body }) => ({
        url: generatePath(apiRoutes.patientImageReviewVote, { id, voteId }),
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['patient'],
    }),
  }),
});

let mockUserId = 'reviewer-1';
const mockNotifyError = jest.fn();
const mockNotifySuccess = jest.fn();

jest.mock('../../../store/apis', () => ({
  useAddPatientImageReviewVoteMutation: (options: object) =>
    mockApi.useAddPatientImageReviewVoteMutation(options),
  useUpdatePatientImageReviewVoteMutation: (options: object) =>
    mockApi.useUpdatePatientImageReviewVoteMutation(options),
}));
jest.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ userId: mockUserId, isDoctor: true, isAdmin: false }),
}));
jest.mock('../../../modules/notifications', () => ({
  useNotifications: () => ({ notifyError: mockNotifyError, notifySuccess: mockNotifySuccess }),
}));
jest.mock('./PatientImageVotes', () => ({ PatientImageVotes: () => null }));

const image = (id: string): ReviewPanelImage => ({
  id,
  status: 'not_reviewed' as ReviewPanelImage['status'],
  isAbnormal: false,
  votesCount: 0,
  normalVotes: 0,
  abnormalVotes: 0,
  uncertainVotes: 0,
  adminResolutionId: null,
  adminResolutionName: null,
  resolutionComment: null,
  votes: [],
  implicitNormals: [],
});

const IMAGE_A = '0a0a0a0a-0000-4000-8000-00000000000a';
const IMAGE_B = '0b0b0b0b-0000-4000-8000-00000000000b';
const LABEL: Record<string, string> = {
  [IMAGE_A]: 'Slice 1 / 2 loaded · Instance #10',
  [IMAGE_B]: 'Slice 2 / 2 loaded · Instance #11',
};

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const voteButton = () => screen.getByRole('button', { name: 'Vote' }) as HTMLButtonElement;

let store: ReturnType<typeof makeStore>;
const makeStore = () =>
  configureStore({
    reducer: { [mockApi.reducerPath]: mockApi.reducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(mockApi.middleware),
  });
const panel = (imageId: string) => (
  <Provider store={store}>
    <PatientImageReview item={image(imageId)} targetLabel={LABEL[imageId]} />
  </Provider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockNetwork.length = 0;
  mockUserId = 'reviewer-1';
  store = makeStore();
});

describe('PatientImageVote with RTK Query', () => {
  it('a vote pending on A while B is shown: per image and per reviewer, reported for A', async () => {
    const { rerender } = render(panel(IMAGE_A));
    fireEvent.click(radio('Abnormal'));
    fireEvent.click(voteButton());

    expect(mockNetwork).toHaveLength(1);
    expect(mockNetwork[0].request).toEqual({
      url: `/patients/images/${IMAGE_A}/review-votes`,
      method: 'POST',
      body: { vote: 'abnormal', comment: '' },
    });
    expect(voteButton().disabled).toBe(true);

    // B is independent: not saving, its own (default) form.
    rerender(panel(IMAGE_B));
    expect(voteButton().disabled).toBe(false);
    expect(radio('Normal').checked).toBe(true);

    // Back on A while the request is pending: still saving.
    rerender(panel(IMAGE_A));
    expect(voteButton().disabled).toBe(true);

    // Another reviewer on A (same browser store): not their pending vote.
    mockUserId = 'reviewer-2';
    rerender(panel(IMAGE_A));
    expect(voteButton().disabled).toBe(false);
    expect(radio('Normal').checked).toBe(true);

    // Reviewer 1 is on B when A's request ends.
    mockUserId = 'reviewer-1';
    rerender(panel(IMAGE_B));
    await act(async () => mockNetwork[0].succeed());

    expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
    expect(mockNotifySuccess).toHaveBeenCalledWith(`Vote added: ${LABEL[IMAGE_A]}`);
    expect(mockNotifyError).not.toHaveBeenCalled();
    expect(voteButton().disabled).toBe(false);
    rerender(panel(IMAGE_A));
    expect(voteButton().disabled).toBe(false);
    // Only A was ever sent.
    expect(mockNetwork).toHaveLength(1);
  });

  it('a failed pending vote is reported for A and A can be voted again', async () => {
    const { rerender } = render(panel(IMAGE_A));
    fireEvent.click(voteButton());
    rerender(panel(IMAGE_B));
    await act(async () => mockNetwork[0].fail(409, 'review is frozen'));

    expect(mockNotifySuccess).not.toHaveBeenCalled();
    expect(mockNotifyError).toHaveBeenCalledWith(
      `Vote not saved (${LABEL[IMAGE_A]}): review is frozen`
    );
    rerender(panel(IMAGE_A));
    expect(voteButton().disabled).toBe(false);
  });
});
