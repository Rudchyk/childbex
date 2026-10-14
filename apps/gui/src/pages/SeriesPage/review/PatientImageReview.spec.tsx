/**
 * The review panel's vote form belongs to one image: unsaved choices never
 * move to another image, a refetched copy of the saved vote keeps unsaved
 * edits, and a vote always goes to (and is reported for) the image whose
 * form was submitted, also when another slice is shown meanwhile.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SeriesImage } from '@libs/schemas';
import { PatientImageReview, type ReviewPanelImage } from './PatientImageReview';

const mockAdd = jest.fn();
const mockUpdate = jest.fn();
const mockNotifyError = jest.fn();
const mockNotifySuccess = jest.fn();
/** Mutation hook options by endpoint (to check the per-image cache key). */
const mockHookOptions: { add: unknown[]; update: unknown[] } = { add: [], update: [] };
/** Images whose vote is being saved (shared mutation state, by cache key). */
const mockSaving = new Set<string>();

jest.mock('../../../store/apis', () => ({
  useAddPatientImageReviewVoteMutation: (options: { fixedCacheKey: string }) => {
    mockHookOptions.add.push(options);
    return [mockAdd, { isLoading: mockSaving.has(options.fixedCacheKey) }];
  },
  useUpdatePatientImageReviewVoteMutation: (options: { fixedCacheKey: string }) => {
    mockHookOptions.update.push(options);
    return [mockUpdate, { isLoading: false }];
  },
}));
jest.mock('../../../auth/useAuth', () => ({
  useAuth: () => ({ userId: 'sub-me', isDoctor: true, isAdmin: false, roles: [], hasRole: () => false }),
}));
jest.mock('../../../modules/notifications', () => ({
  useNotifications: () => ({ notifyError: mockNotifyError, notifySuccess: mockNotifySuccess }),
}));
jest.mock('./PatientImageVotes', () => ({ PatientImageVotes: () => null }));

type Vote = SeriesImage['votes'][number];

const vote = (imageId: string, value: 'normal' | 'abnormal' | 'uncertain', comment: string | null): Vote => ({
  id: `v-${imageId}`,
  patientImageId: imageId,
  reviewerId: 'sub-me',
  reviewerName: 'Me',
  vote: value as Vote['vote'],
  comment,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const image = (id: string, votes: Vote[] = []): ReviewPanelImage => ({
  id,
  status: 'not_reviewed' as ReviewPanelImage['status'],
  isAbnormal: false,
  votesCount: votes.length,
  normalVotes: 0,
  abnormalVotes: 0,
  uncertainVotes: 0,
  adminResolutionId: null,
  adminResolutionName: null,
  resolutionComment: null,
  votes,
  implicitNormals: [],
});

const LABEL_A = 'Slice 1 / 2 loaded · Instance #10';
const LABEL_B = 'Slice 2 / 2 loaded · Instance #11';

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const commentField = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;
const voteButton = () => screen.getByRole('button', { name: 'Vote' }) as HTMLButtonElement;
/** A request that ends when the test says so. */
const pendingRequest = () => {
  let settle: { resolve: () => void; reject: (error: unknown) => void } = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { result: { unwrap: () => promise }, settle: () => settle };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockHookOptions.add = [];
  mockHookOptions.update = [];
  mockSaving.clear();
  mockAdd.mockReturnValue({ unwrap: () => Promise.resolve() });
  mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve() });
});

describe('PatientImageReview vote form', () => {
  it('A -> B without votes: the unsaved choice and comment stay with A', () => {
    const { rerender } = render(<PatientImageReview item={image('A')} targetLabel={LABEL_A} />);
    expect(radio('Normal').checked).toBe(true); // the established default
    fireEvent.click(radio('Abnormal'));
    fireEvent.change(commentField(), { target: { value: 'lesion on A' } });

    rerender(<PatientImageReview item={image('B')} targetLabel={LABEL_B} />);

    expect(radio('Normal').checked).toBe(true);
    expect(radio('Abnormal').checked).toBe(false);
    expect(commentField().value).toBe('');

    fireEvent.click(voteButton());
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith({ id: 'B', vote: 'normal', comment: '' });
  });

  it('A -> B with different votes: each image shows its own vote', () => {
    const a = image('A', [vote('A', 'abnormal', 'from A')]);
    const b = image('B', [vote('B', 'uncertain', 'from B')]);
    const { rerender } = render(<PatientImageReview item={a} targetLabel={LABEL_A} />);
    expect(radio('Abnormal').checked).toBe(true);
    expect(commentField().value).toBe('from A');

    rerender(<PatientImageReview item={b} targetLabel={LABEL_B} />);
    expect(radio('Not sure').checked).toBe(true);
    expect(commentField().value).toBe('from B');

    // An edit on B is not carried back to A.
    fireEvent.change(commentField(), { target: { value: 'unsaved on B' } });
    rerender(<PatientImageReview item={a} targetLabel={LABEL_A} />);
    expect(radio('Abnormal').checked).toBe(true);
    expect(commentField().value).toBe('from A');
  });

  it('a voted image -> an image without a vote: the form starts empty', () => {
    const { rerender } = render(
      <PatientImageReview item={image('A', [vote('A', 'abnormal', 'from A')])} targetLabel={LABEL_A} />
    );
    rerender(<PatientImageReview item={image('B')} targetLabel={LABEL_B} />);
    expect(radio('Normal').checked).toBe(true);
    expect(commentField().value).toBe('');
  });

  it('a refetched copy of the same vote keeps unsaved edits; a changed vote is shown', () => {
    const { rerender } = render(
      <PatientImageReview item={image('A', [vote('A', 'abnormal', 'saved')])} targetLabel={LABEL_A} />
    );
    fireEvent.click(radio('Not sure'));
    fireEvent.change(commentField(), { target: { value: 'still typing' } });

    // Equivalent vote, new objects (e.g. refetch after another image's vote).
    rerender(
      <PatientImageReview item={image('A', [vote('A', 'abnormal', 'saved')])} targetLabel={LABEL_A} />
    );
    expect(radio('Not sure').checked).toBe(true);
    expect(commentField().value).toBe('still typing');

    // The saved vote itself changed (e.g. a bulk vote): it is shown.
    rerender(
      <PatientImageReview item={image('A', [vote('A', 'normal', 'bulk')])} targetLabel={LABEL_A} />
    );
    expect(radio('Normal').checked).toBe(true);
    expect(commentField().value).toBe('bulk');
  });

  it('changes an existing vote of the image the form belongs to', async () => {
    render(<PatientImageReview item={image('A', [vote('A', 'abnormal', 'x')])} targetLabel={LABEL_A} />);
    fireEvent.click(radio('Not sure'));
    fireEvent.click(voteButton());
    expect(mockUpdate).toHaveBeenCalledWith({ voteId: 'v-A', id: 'A', vote: 'uncertain', comment: 'x' });
    expect(mockAdd).not.toHaveBeenCalled();
    await waitFor(() => expect(mockNotifySuccess).toHaveBeenCalledWith(`Vote updated: ${LABEL_A}`));
  });

  it('a vote pending while another slice is shown is saved and reported for its own image', async () => {
    const request = pendingRequest();
    mockAdd.mockReturnValueOnce(request.result);
    const { rerender } = render(<PatientImageReview item={image('A')} targetLabel={LABEL_A} />);
    fireEvent.click(radio('Abnormal'));
    fireEvent.click(voteButton());
    expect(mockAdd).toHaveBeenCalledWith({ id: 'A', vote: 'abnormal', comment: '' });

    rerender(<PatientImageReview item={image('B')} targetLabel={LABEL_B} />);
    await act(async () => request.settle().resolve());

    expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
    expect(mockNotifySuccess).toHaveBeenCalledWith(`Vote added: ${LABEL_A}`);
    // B's form is untouched.
    expect(radio('Normal').checked).toBe(true);
  });

  it('a failed pending vote is reported for its own image', async () => {
    const request = pendingRequest();
    mockAdd.mockReturnValueOnce(request.result);
    const { rerender } = render(<PatientImageReview item={image('A')} targetLabel={LABEL_A} />);
    fireEvent.click(voteButton());
    rerender(<PatientImageReview item={image('B')} targetLabel={LABEL_B} />);
    await act(async () =>
      request.settle().reject({ status: 409, data: { message: 'review is frozen' } })
    );

    expect(mockNotifySuccess).not.toHaveBeenCalled();
    expect(mockNotifyError).toHaveBeenCalledWith(`Vote not saved (${LABEL_A}): review is frozen`);
  });

  it("the saving state is per image: A's pending vote does not block B, and shows again on A", () => {
    mockSaving.add('review-vote:A');
    const { rerender } = render(<PatientImageReview item={image('A')} targetLabel={LABEL_A} />);
    expect(voteButton().disabled).toBe(true);

    rerender(<PatientImageReview item={image('B')} targetLabel={LABEL_B} />);
    expect(voteButton().disabled).toBe(false);

    rerender(<PatientImageReview item={image('A')} targetLabel={LABEL_A} />);
    expect(voteButton().disabled).toBe(true);
    expect(mockHookOptions.add).toContainEqual({ fixedCacheKey: 'review-vote:A' });
    expect(mockHookOptions.add).toContainEqual({ fixedCacheKey: 'review-vote:B' });
  });
});
