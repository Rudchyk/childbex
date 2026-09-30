/**
 * The viewer loads protected image URLs with the caller's request headers.
 * dwv itself (canvas rendering) is replaced by a fake App.
 */
import { act, render, waitFor } from '@testing-library/react';
import { DicomViewer } from './DicomViewer';

const mockLoadURLs = jest.fn();
const mockReset = jest.fn();
/** Listeners the viewer registered on the (fake) dwv App, by event. */
const mockListeners: Record<string, (event: unknown) => void> = {};

jest.mock('dwv', () => ({
  App: jest.fn().mockImplementation(() => ({
    init: jest.fn(),
    addEventListener: (name: string, listener: (event: unknown) => void) => {
      mockListeners[name] = listener;
    },
    loadURLs: mockLoadURLs,
    loadFiles: jest.fn(),
    reset: mockReset,
    onResize: jest.fn(),
  })),
  AppOptions: jest.fn(),
  ViewConfig: jest.fn(),
  Index: jest.fn(),
}));
jest.mock('./DicomViewerTools', () => ({ DicomViewerTools: () => null }));
jest.mock('./DicomViewerSidebar', () => ({ DicomViewerSidebar: () => null }));
jest.mock('./DicomViewerFooter', () => ({ DicomViewerFooter: () => null }));
jest.mock('./DicomViewerDropbox', () => ({ DicomViewerDropbox: () => null }));

const urls = [
  '/api/v1/patients/p1/images/i1/file',
  '/api/v1/patients/p1/images/i2/file',
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DicomViewer', () => {
  it('loads the URLs with the resolved request headers', async () => {
    const getRequestHeaders = jest.fn(async () => ({
      authorization: 'Bearer test-token',
    }));

    render(<DicomViewer list={urls} getRequestHeaders={getRequestHeaders} />);

    await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
    expect(mockLoadURLs).toHaveBeenCalledWith(urls, {
      requestHeaders: [{ name: 'authorization', value: 'Bearer test-token' }],
    });
  });

  it('loads the URLs without extra headers when none are requested', async () => {
    render(<DicomViewer list={urls} />);

    await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
    expect(mockLoadURLs).toHaveBeenCalledWith(urls, { requestHeaders: [] });
  });

  it('does not load after it was unmounted while resolving headers', async () => {
    let resolveHeaders: (headers: Record<string, string>) => void = () =>
      undefined;
    const getRequestHeaders = () =>
      new Promise<Record<string, string>>((resolve) => {
        resolveHeaders = resolve;
      });

    const { unmount } = render(
      <DicomViewer list={urls} getRequestHeaders={getRequestHeaders} />
    );
    unmount();
    await act(async () => {
      resolveHeaders({ authorization: 'Bearer late' });
    });

    expect(mockLoadURLs).not.toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalled();
  });

  it('reports load errors so callers know not everything is shown', async () => {
    const onLoadResult = jest.fn();
    render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
    await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
    expect(onLoadResult).not.toHaveBeenCalled();

    act(() => mockListeners.loaderror({ error: new Error('404') }));

    expect(onLoadResult).toHaveBeenLastCalledWith({ sliceCount: 0, errorCount: 1 });
  });

  it('loads nothing without a list (local files mode)', async () => {
    const getRequestHeaders = jest.fn(async () => ({}));

    render(<DicomViewer isClean getRequestHeaders={getRequestHeaders} />);
    await act(async () => undefined);

    expect(getRequestHeaders).not.toHaveBeenCalled();
    expect(mockLoadURLs).not.toHaveBeenCalled();
  });
});
