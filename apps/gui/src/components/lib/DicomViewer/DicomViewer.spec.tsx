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
const mockAbortAllLoads = jest.fn();
const mockSetTool = jest.fn();
const mockSetToolFeatures = jest.fn();
const mockFitToContainer = jest.fn();
const mockDefaultOnKeydown = jest.fn();
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
/** The loaded volume (dwv image); undefined: no slices. */
let mockImage: unknown;
let mockViewLayers: unknown[] | undefined;
const mockImageWithSlices = (count: number) => ({
  getGeometry: () => ({ getSize: () => ({ get: () => count }) }),
  getImageUid: (index: { values: number[] }) => `uid-${index.values[2]}`,
});
/** A loaded item's DICOM elements: its SOP Instance UID. */
const sopUid = (uid: string) => ({ '00080018': { value: [uid] } });
let mockAppOptions: { tools?: Record<string, { options?: string[] }> } = {};
let mockToolsProps: {
  tools: readonly string[];
  onChangeTool: (tool: string) => void;
  calibration?: { kind: string };
  isDataLoaded: boolean;
  isLoadSuccessful: boolean;
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
    abortAllLoads: mockAbortAllLoads,
    onResize: jest.fn(),
    fitToContainer: mockFitToContainer,
    defaultOnKeydown: mockDefaultOnKeydown,
    getStyle: () => mockStyle,
    setTool: mockSetTool,
    setToolFeatures: mockSetToolFeatures,
    getActiveLayerGroup: () => ({ setActiveLayer: jest.fn() }),
    getMetaData: () => mockMeta,
    getData: () => ({ image: mockImage }),
    getViewLayersByDataId: () => mockViewLayers,
  })),
  AppOptions: jest.fn().mockImplementation(() => {
    mockAppOptions = {};
    return mockAppOptions;
  }),
  ViewConfig: jest.fn(),
  Index: jest.fn().mockImplementation(function (
    this: { values: number[] },
    values: number[]
  ) {
    this.values = values;
  }),
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
  mockImage = mockImageWithSlices(1);
  mockViewLayers = [
    {
      getViewController: () => ({
        canScroll: () => true,
        isMonochrome: () => true,
        getCurrentIndex: () => ({ getValues: () => [0, 0, 0] }),
      }),
    },
  ];
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

    expect(onLoadResult).toHaveBeenLastCalledWith({
      sliceCount: 0,
      errorCount: 1,
      loadedSources: [],
    });
  });

  describe('loadend safety', () => {
    it.each(['missing image', 'missing view layer', 'missing controller'])(
      'does not report a loaded stack with %s',
      (missing) => {
        if (missing === 'missing image') mockImage = undefined;
        if (missing === 'missing view layer') mockViewLayers = [];
        if (missing === 'missing controller') {
          mockViewLayers = [{ getViewController: () => undefined }];
        }

        const onLoadResult = jest.fn();
        render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
        act(() => {
          mockListeners.loadend({ dataid: '0' });
          // A late successful event cannot turn a non-displayable stack green.
          mockListeners.load({});
        });

        expect(
          screen.getByText(/DICOM image stack could not be displayed/)
        ).toBeTruthy();
        expect(mockToolsProps?.isDataLoaded).toBe(false);
        expect(mockToolsProps?.isLoadSuccessful).toBe(false);
        expect(onLoadResult).toHaveBeenLastCalledWith({
          sliceCount: 0,
          errorCount: 1,
          loadedSources: [],
        });
      }
    );

    it('ignores DWV events emitted synchronously during cleanup', async () => {
      const onLoadResult = jest.fn();
      const { unmount } = render(
        <DicomViewer list={urls} onLoadResult={onLoadResult} />
      );
      await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
      mockViewLayers = [];
      mockAbortAllLoads.mockImplementationOnce(() => {
        mockListeners.loadend({ dataid: '0' });
        mockListeners.loadabort({ error: new Error('cancelled') });
      });
      unmount();

      expect(mockAbortAllLoads).toHaveBeenCalledTimes(1);
      expect(onLoadResult).not.toHaveBeenCalled();
    });

    it('ignores DWV events delivered after unmount', async () => {
      const onLoadResult = jest.fn();
      const { unmount } = render(
        <DicomViewer list={urls} onLoadResult={onLoadResult} />
      );
      await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
      const { custom } = jest.requireMock('dwv');
      delete custom.labelTexts;

      unmount();
      mockSetTool.mockClear();
      // A displayable stack: without the unmount guard, loadend would still
      // drive the (reset) dwv app and its global label template.
      act(() => {
        mockListeners.loadend({ dataid: '0' });
        mockListeners.loadabort({ error: new Error('cancelled') });
        mockListeners.load({});
        mockListeners.keydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      });

      expect(mockAbortAllLoads).toHaveBeenCalledTimes(1);
      expect(mockSetTool).not.toHaveBeenCalled();
      expect(custom.labelTexts).toBeUndefined();
      expect(mockDefaultOnKeydown).not.toHaveBeenCalled();
      expect(onLoadResult).not.toHaveBeenCalled();
    });

    it('reports a failed stack when every image failed before loadend', () => {
      const onLoadResult = jest.fn();
      render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
      // dwv: each failed request is a loaderror; loadend follows once all
      // requests ended, with no image decoded and so no view layer.
      mockImage = undefined;
      mockViewLayers = [];
      act(() => {
        mockListeners.loaderror({ error: new Error('503') });
        mockListeners.loaderror({ error: new Error('503') });
        mockListeners.loadend({ dataid: '0' });
      });

      expect(screen.getByRole('alert').textContent).toMatch(
        /DICOM image stack could not be displayed/
      );
      expect(mockToolsProps?.isDataLoaded).toBe(false);
      expect(mockToolsProps?.isLoadSuccessful).toBe(false);
      expect(onLoadResult).toHaveBeenLastCalledWith({
        sliceCount: 0,
        errorCount: 3,
        loadedSources: [],
      });
    });

    it('reports a successful load (dwv order: load, then loadend)', () => {
      const onLoadResult = jest.fn();
      render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
      mockImage = mockImageWithSlices(2);
      act(() => {
        mockListeners.loaditem({ source: urls[0], data: sopUid('uid-0') });
        mockListeners.loaditem({ source: urls[1], data: sopUid('uid-1') });
        mockListeners.load({});
        mockListeners.loadend({ dataid: '0' });
      });

      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockToolsProps?.isDataLoaded).toBe(true);
      expect(mockToolsProps?.isLoadSuccessful).toBe(true);
      expect(mockSetTool).toHaveBeenLastCalledWith('Scroll');
      expect(onLoadResult).toHaveBeenLastCalledWith({
        sliceCount: 2,
        errorCount: 0,
        loadedSources: [urls[0], urls[1]],
      });
    });

    it('reports a partial load: the shown slice and the failed image', () => {
      const onLoadResult = jest.fn();
      render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
      // dwv: no load event when a request failed; loadend still follows.
      mockImage = mockImageWithSlices(1);
      act(() => {
        mockListeners.loaditem({ source: urls[0], data: sopUid('uid-0') });
        mockListeners.loaderror({ error: new Error('503') });
        mockListeners.loadend({ dataid: '0' });
      });

      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockToolsProps?.isDataLoaded).toBe(true);
      expect(mockToolsProps?.isLoadSuccessful).toBe(false);
      expect(onLoadResult).toHaveBeenLastCalledWith({
        sliceCount: 1,
        errorCount: 1,
        loadedSources: [urls[0]],
      });
    });
  });

  describe('the slice on screen and the loaded volume', () => {
    /** A volume of two slices whose order differs from the list order. */
    const loadTwoSlices = () => {
      mockImage = {
        getGeometry: () => ({ getSize: () => ({ get: () => 2 }) }),
        getImageUid: (index: { values: number[] }) => `uid-${index.values[2]}`,
      };
      act(() => {
        mockListeners.loaditem({ source: urls[0], data: sopUid('uid-1') });
        mockListeners.loaditem({ source: urls[1], data: sopUid('uid-0') });
      });
    };

    it('reports which list entries the loaded slices are', () => {
      const onLoadResult = jest.fn();
      render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
      loadTwoSlices();
      act(() => mockListeners.loadend({ dataid: '0' }));

      expect(onLoadResult).toHaveBeenLastCalledWith({
        sliceCount: 2,
        errorCount: 0,
        loadedSources: [urls[1], urls[0]],
      });
    });

    it('reports the slice on screen with its position in the loaded volume', () => {
      const onCurrentItemChange = jest.fn();
      render(<DicomViewer list={urls} onCurrentItemChange={onCurrentItemChange} />);
      loadTwoSlices();

      // Before the volume is known: the source, no position.
      act(() => mockListeners.positionchange({ data: { imageUid: 'uid-1' } }));
      expect(onCurrentItemChange).toHaveBeenLastCalledWith(urls[0], undefined);

      // dwv shows the last slice once loaded.
      act(() => mockListeners.loadend({ dataid: '0' }));
      expect(onCurrentItemChange).toHaveBeenLastCalledWith(urls[0], {
        index: 1,
        loadedCount: 2,
      });

      act(() => mockListeners.positionchange({ data: { imageUid: 'uid-0' } }));
      expect(onCurrentItemChange).toHaveBeenLastCalledWith(urls[1], {
        index: 0,
        loadedCount: 2,
      });
    });
  });

  it('stops loading when unmounted (e.g. another Series is opened)', async () => {
    const { unmount } = render(<DicomViewer list={urls} />);
    await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
    unmount();
    expect(mockAbortAllLoads).toHaveBeenCalledTimes(1);
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
