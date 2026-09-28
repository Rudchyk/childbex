/**
 * The cluster page loads image files only through the authenticated API
 * (never from the stored `/uploads/...` source) and keeps review/sidebar
 * lookups working with those URLs.
 */
import { act, render, screen } from '@testing-library/react';
import type { GetPatientClusterResponse } from '@libs/schemas';
import { PatientImages } from './PatientImages';

type ViewerProps = {
  list: string[];
  getRequestHeaders?: () => Promise<Record<string, string>>;
  onCurrentItemChange: (source: string) => void;
  sidebarItemIcon: (source: string) => unknown;
};
let mockViewerProps: ViewerProps | undefined;
const mockAuthHeaders = jest.fn(async () => ({ authorization: 'Bearer t' }));

jest.mock('../../components', () => ({
  DicomViewer: (props: ViewerProps) => {
    mockViewerProps = props;
    return null;
  },
}));
jest.mock('../../store/apis', () => ({ apiBaseUrl: '/api/v1' }));
jest.mock('../../modules/archiveUpload/httpTransport', () => ({
  keycloakAuthHeaders: () => mockAuthHeaders(),
}));
jest.mock('./PatientImagesTags', () => ({ PatientImagesTags: () => null }));
jest.mock('./PatientImageReview', () => ({
  PatientImageReview: ({ item }: { item: { id: string } }) => (
    <div>review:{item.id}</div>
  ),
}));

const PATIENT = '11111111-1111-4111-8111-111111111111';
const CLUSTER = '33333333-3333-4333-8333-333333333333';
const NORMAL = '44444444-4444-4444-8444-444444444444';
const ABNORMAL = '55555555-5555-4555-8555-555555555555';

const image = (id: string, isAbnormal: boolean) => ({
  id,
  source: `/uploads/${PATIENT}/${CLUSTER}/${id}.dcm`,
  clusterId: CLUSTER,
  isBrocken: false,
  isAbnormal,
  details: null,
  status: 'not_reviewed',
  adminResolutionId: null,
  adminResolutionName: null,
  resolutionComment: null,
  votesCount: 0,
  normalVotes: 0,
  abnormalVotes: 0,
  uncertainVotes: 0,
  votes: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const data = {
  id: CLUSTER,
  cluster: 0,
  name: 'AXIAL',
  patientId: PATIENT,
  notes: '',
  studyDate: null,
  inReview: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  images: [image(NORMAL, false), image(ABNORMAL, true)],
} as unknown as GetPatientClusterResponse;

const fileUrl = (imageId: string) =>
  `/api/v1/patients/${PATIENT}/images/${imageId}/file`;

beforeEach(() => {
  mockViewerProps = undefined;
});

describe('PatientImages', () => {
  it('passes authenticated API file URLs to the viewer, never /uploads', () => {
    render(<PatientImages data={data} />);

    expect(mockViewerProps?.list).toEqual([fileUrl(NORMAL), fileUrl(ABNORMAL)]);
    expect(mockViewerProps?.list.some((url) => url.includes('/uploads'))).toBe(
      false
    );
  });

  it('loads the files with the Keycloak authorization header', async () => {
    render(<PatientImages data={data} />);

    await expect(mockViewerProps?.getRequestHeaders?.()).resolves.toEqual({
      authorization: 'Bearer t',
    });
  });

  it('finds the image for review and the sidebar icon by its file URL', () => {
    render(<PatientImages data={data} />);

    expect(() =>
      mockViewerProps?.sidebarItemIcon(fileUrl(ABNORMAL))
    ).not.toThrow();
    act(() => mockViewerProps?.onCurrentItemChange(fileUrl(ABNORMAL)));

    expect(screen.getByText(`review:${ABNORMAL}`)).toBeTruthy();
  });
});
