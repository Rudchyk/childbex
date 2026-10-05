/**
 * The viewer loads protected image URLs with the caller's request headers,
 * offers the Ruler next to the existing Area (rectangle) measurement, labels
 * lengths by their real calibration and renders at the display's pixel
 * ratio. dwv itself (canvas rendering) is replaced by a fake App.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { DicomViewer } from './DicomViewer';

const mockLoadURLs = jest.fn();
const mockReset = jest.fn();
const mockSetTool = jest.fn();
const mockSetToolFeatures = jest.fn();
const mockFitToContainer = jest.fn();
/** Listeners the viewer registered on the (fake) dwv App, by event. */
const mockListeners: Record<string, (event: unknown) => void> = {};
/** dwv's draw style (the parts the viewer adapts). */
class MockStyle {
  applyZoomScale(value: number) {
    return { x: value, y: value };
  }
  getStrokeWidth() {
    return 2;
  }
}
const mockStyle = new MockStyle();
/** Another instance of the class (dwv's Draw tool owns its own Style). */
const drawToolStyle = new MockStyle();
let mockMeta: Record<string, unknown> = {};
let mockAppOptions: { tools?: Record<string, { options?: string[] }> } = {};
let mockToolsProps: {
  tools: readonly string[];
  onChangeTool: (tool: string) => void;
  calibration?: { kind: string };
} | null = null;

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
    fitToContainer: mockFitToContainer,
    getStyle: () => mockStyle,
    setTool: mockSetTool,
    setToolFeatures: mockSetToolFeatures,
    getActiveLayerGroup: () => ({ setActiveLayer: jest.fn() }),
    getMetaData: () => mockMeta,
    getData: () => ({ image: undefined }),
    getViewLayersByDataId: () => [
      {
        getViewController: () => ({
          canScroll: () => true,
          isMonochrome: () => true,
          getCurrentIndex: () => ({ getValues: () => [0, 0, 0] }),
        }),
      },
    ],
  })),
  AppOptions: jest.fn().mockImplementation(() => {
    mockAppOptions = {};
    return mockAppOptions;
  }),
  ViewConfig: jest.fn(),
  Index: jest.fn(),
  Point2D: jest.fn(),
  custom: {},
}));
jest.mock('./DicomViewerTools', () => ({
  DicomViewerTools: (props: typeof mockToolsProps) => {
    mockToolsProps = props;
    return null;
  },
}));
jest.mock('./DicomViewerSidebar', () => ({ DicomViewerSidebar: () => null }));
jest.mock('./DicomViewerFooter', () => ({ DicomViewerFooter: () => null }));
jest.mock('./DicomViewerDropbox', () => ({ DicomViewerDropbox: () => null }));

const urls = [
  '/api/v1/patients/p1/images/i1/file',
  '/api/v1/patients/p1/images/i2/file',
];

const setPixelRatio = (ratio: number, coarse = false) => {
  Object.defineProperty(window, 'devicePixelRatio', { value: ratio, configurable: true });
  // Only the coarse-pointer query matches (when asked to); MUI's media
  // queries (breakpoints) never do.
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: coarse && query.includes('pointer: coarse'),
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as never;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMeta = {};
  mockToolsProps = null;
  setPixelRatio(1);
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

  describe('measurements', () => {
    it("offers the Ruler and keeps the Area (rectangle) tool, both dwv Draw shapes", () => {
      render(<DicomViewer list={urls} />);
      expect(mockAppOptions.tools?.Draw?.options).toEqual(['Ruler', 'Rectangle']);
      expect(mockToolsProps?.tools).toEqual(
        expect.arrayContaining(['Scroll', 'WindowLevel', 'ZoomAndPan', 'Ruler', 'Rectangle'])
      );

      act(() => mockToolsProps?.onChangeTool('Ruler'));
      expect(mockSetTool).toHaveBeenLastCalledWith('Draw');
      expect(mockSetToolFeatures).toHaveBeenLastCalledWith({ shapeName: 'Ruler' });

      act(() => mockToolsProps?.onChangeTool('Rectangle'));
      expect(mockSetTool).toHaveBeenLastCalledWith('Draw');
      expect(mockSetToolFeatures).toHaveBeenLastCalledWith({ shapeName: 'Rectangle' });

      act(() => mockToolsProps?.onChangeTool('ZoomAndPan'));
      expect(mockSetTool).toHaveBeenLastCalledWith('ZoomAndPan');
    });

    it.each([
      [{ '00280030': { value: ['0.7', '0.7'] } }, 'pixelSpacing', '{length}'],
      [{ '00181164': { value: ['0.2', '0.2'] } }, 'imagerPixelSpacing', '{length} (at detector)'],
      [{ '00280034': { value: ['1', '1'] } }, 'uncalibrated', '{length} (NOT calibrated)'],
      [{}, 'uncalibrated', '{length}'],
    ])('labels lengths by the real calibration of %j', (meta, kind, rulerLabel) => {
      mockMeta = meta;
      render(<DicomViewer list={urls} />);
      act(() => mockListeners.loadend({ dataid: '0' }));
      expect(mockToolsProps?.calibration).toMatchObject({ kind });
      // dwv's label template (`custom.labelTexts`), keyed by shape.
      const { custom } = jest.requireMock('dwv');
      expect(custom.labelTexts.ruler['*']).toBe(rulerLabel);
      expect(custom.labelTexts.rectangle['*']).toMatch(/^\{surface\}/);
    });
  });

  describe('display resolution', () => {
    const sizeViewport = (width: number, height: number) => {
      jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
      jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
    };
    afterEach(() => jest.restoreAllMocks());

    it('gives dwv one canvas pixel per device pixel on a high-DPI display', () => {
      sizeViewport(800, 600);
      setPixelRatio(2);
      render(<DicomViewer list={urls} />);
      const container = document.getElementById('layerGroup0') as HTMLElement;
      expect(container.style.width).toBe('1600px');
      expect(container.style.height).toBe('1200px');
      expect(container.style.transform).toBe('scale(0.5)');
      // Labels, anchors and strokes keep their CSS size.
      expect(mockStyle.applyZoomScale(6)).toEqual({ x: 12, y: 12 });
      expect(drawToolStyle.applyZoomScale(6)).toEqual({ x: 12, y: 12 });
      expect(drawToolStyle.getStrokeWidth()).toBe(4);
      expect(screen.getByTestId('dicom-viewport')).toBeTruthy();
    });

    it('keeps CSS pixels on standard displays and with touch input', () => {
      sizeViewport(800, 600);
      setPixelRatio(2, true);
      render(<DicomViewer list={urls} />);
      const container = document.getElementById('layerGroup0') as HTMLElement;
      expect(container.style.width).toBe('800px');
      expect(container.style.transform).toBe('scale(1)');
      expect(drawToolStyle.getStrokeWidth()).toBe(2);
    });
  });
});
