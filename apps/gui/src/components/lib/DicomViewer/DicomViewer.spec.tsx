/**
 * The viewer loads protected image URLs with the caller's request headers,
 * offers the Ruler next to the existing Area (rectangle) measurement, labels
 * lengths by their real calibration and renders at the display's pixel
 * ratio. dwv itself (canvas rendering) is replaced by a fake App.
 */
import { useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { DicomViewer } from './DicomViewer';

const mockLoadURLs = jest.fn();
const mockReset = jest.fn();
const mockAbortAllLoads = jest.fn();
const mockSetTool = jest.fn();
const mockSetToolFeatures = jest.fn();
const mockFitToContainer = jest.fn();
const mockResetZoomPan = jest.fn();
const mockDefaultOnKeydown = jest.fn();
/** dwv's data storage: ids of the data it holds, and removed ones. */
let mockDataIds = new Set<string>();
let mockRemovedIds = new Set<string>();
const mockAbortLoad = jest.fn((dataId: string) => {
  mockDataIds.delete(dataId);
  mockRemovedIds.add(dataId);
});
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
/** The view layer `jumpTo` moves (undefined: nothing to show yet). */
let mockActiveViewLayer: unknown;
/** dwv's active layer group, when a test needs more than `jumpTo`. */
let mockLayerGroup: unknown;
/** dwv's draw layers (`App#getDrawLayers`). */
let mockDrawLayers: { getKonvaLayer: () => unknown }[] = [];
const mockSetCurrentIndex = jest.fn();
/** A volume of single-frame slices (dwv's slice count and total size). */
const mockImageWithSlices = (count: number) => ({
  getGeometry: () => ({ getSize: () => ({ get: () => count, getTotalSize: () => count }) }),
  getImageUid: (index: { values: number[] }) => `uid-${index.values[2]}`,
});
/**
 * Animation frames the viewer requested: run explicitly (`runFrames`), so
 * tests see exactly how many reconciliations it makes.
 */
let mockFrames = new Map<number, FrameRequestCallback>();
let mockFrameId = 0;
const runFrames = () =>
  act(() => {
    const frames = [...mockFrames.values()];
    mockFrames.clear();
    frames.forEach((frame) => frame(0));
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
  onClean?: () => void;
  canClean?: boolean;
  onReset: () => void;
  onActualPixels: () => void;
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
    resetZoomPan: mockResetZoomPan,
    defaultOnKeydown: mockDefaultOnKeydown,
    getStyle: () => mockStyle,
    setTool: mockSetTool,
    setToolFeatures: mockSetToolFeatures,
    getActiveLayerGroup: () =>
      mockLayerGroup ?? {
        setActiveLayer: jest.fn(),
        getActiveViewLayer: () => mockActiveViewLayer,
      },
    getMetaData: () => mockMeta,
    getData: (dataId: string) =>
      mockRemovedIds.has(`${dataId}`) ? undefined : { image: mockImage },
    getDataIds: () => [...mockDataIds],
    abortLoad: mockAbortLoad,
    getViewLayersByDataId: () => mockViewLayers,
    getDrawLayers: () => mockDrawLayers,
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
  Point2D: jest.fn().mockImplementation(function (
    this: { getX: () => number; getY: () => number },
    x: number,
    y: number
  ) {
    this.getX = () => x;
    this.getY = () => y;
  }),
  custom: {},
}));
jest.mock('./DicomViewerTools', () => ({
  DicomViewerTools: (props: typeof mockToolsProps) => {
    mockToolsProps = props;
    return <div data-testid="viewer-tools" />;
  },
}));
/** The default image list's props (last render). */
let mockSidebarProps: {
  items: { index: number }[];
  currentImageId?: string;
  onJumpTo: (index: number) => void;
  expanded: boolean;
  onToggle: () => void;
} | null = null;
jest.mock('./DicomViewerSidebar', () => ({
  DicomViewerSidebar: (props: NonNullable<typeof mockSidebarProps>) => {
    mockSidebarProps = props;
    return <div data-testid="default-sidebar" data-expanded={props.expanded} />;
  },
}));
jest.mock('./DicomViewerFooter', () => ({ DicomViewerFooter: () => null }));
/** The local import's props (last render). */
let mockDropboxProps: { isShow: boolean; onLoadFiles: (files: File[]) => void } | null =
  null;
jest.mock('./DicomViewerDropbox', () => ({
  DicomViewerDropbox: (props: NonNullable<typeof mockDropboxProps>) => {
    mockDropboxProps = props;
    return null;
  },
}));

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
  mockDataIds = new Set();
  mockRemovedIds = new Set();
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
  mockActiveViewLayer = undefined;
  mockLayerGroup = undefined;
  mockDrawLayers = [];
  mockToolsProps = null;
  mockDropboxProps = null;
  mockSidebarProps = null;
  mockFrames = new Map();
  window.requestAnimationFrame = jest.fn((frame: FrameRequestCallback) => {
    mockFrames.set(++mockFrameId, frame);
    return mockFrameId;
  });
  window.cancelAnimationFrame = jest.fn((id: number) => {
    mockFrames.delete(id);
  });
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

    act(() => mockListeners.error({ error: new Error('404') }));
    runFrames();

    expect(onLoadResult).toHaveBeenLastCalledWith({
      sliceCount: 0,
      errorCount: 1,
      metadataErrorCount: 0,
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
          metadataErrorCount: 0,
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
        mockListeners.abort({ error: new Error('cancelled') });
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
        mockListeners.abort({ error: new Error('cancelled') });
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
      // dwv: each failed request is an `error` event; loadend follows once all
      // requests ended, with no image decoded and so no view layer.
      mockImage = undefined;
      mockViewLayers = [];
      act(() => {
        mockListeners.error({ error: new Error('503') });
        mockListeners.error({ error: new Error('503') });
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
        metadataErrorCount: 0,
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
        metadataErrorCount: 0,
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
        mockListeners.error({ error: new Error('503') });
        mockListeners.loadend({ dataid: '0' });
      });

      expect(screen.queryByRole('alert')).toBeNull();
      expect(mockToolsProps?.isDataLoaded).toBe(true);
      expect(mockToolsProps?.isLoadSuccessful).toBe(false);
      expect(onLoadResult).toHaveBeenLastCalledWith({
        sliceCount: 1,
        errorCount: 1,
        metadataErrorCount: 0,
        loadedSources: [urls[0]],
      });
    });
  });

  describe('the slice on screen and the loaded volume', () => {
    /** A volume of two slices whose order differs from the list order. */
    const loadTwoSlices = () => {
      mockImage = mockImageWithSlices(2);
      act(() => {
        mockListeners.loaditem({ source: urls[0], data: sopUid('uid-1') });
        mockListeners.loaditem({ source: urls[1], data: sopUid('uid-0') });
      });
      runFrames();
    };

    it('reports which list entries the loaded slices are', () => {
      const onLoadResult = jest.fn();
      render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
      loadTwoSlices();
      act(() => mockListeners.loadend({ dataid: '0' }));

      expect(onLoadResult).toHaveBeenLastCalledWith({
        sliceCount: 2,
        errorCount: 0,
        metadataErrorCount: 0,
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

    /**
     * A custom list's jump is only a request: the slice on screen (and so
     * the list's active slice) changes only when dwv reports it.
     */
    describe('jumpTo', () => {
      let sidebar: { jumpTo: (index: number) => void; currentImageId?: string };
      const renderWithList = () =>
        render(
          <DicomViewer
            list={urls}
            renderSidebar={(props) => {
              sidebar = props;
              return null;
            }}
          />
        );

      it('asks dwv for the slice and keeps the slice on screen until dwv reports it', () => {
        mockActiveViewLayer = {
          getViewController: () => ({
            getCurrentIndex: () => ({ getValues: () => [0, 0, 1] }),
            setCurrentIndex: mockSetCurrentIndex,
          }),
        };
        renderWithList();
        loadTwoSlices();
        act(() => mockListeners.loadend({ dataid: '0' }));
        expect(sidebar.currentImageId).toBe('uid-1');

        act(() => sidebar.jumpTo(0));
        expect(mockSetCurrentIndex).toHaveBeenCalledTimes(1);
        expect(mockSetCurrentIndex.mock.calls[0][0].values).toEqual([0, 0, 0]);
        expect(sidebar.currentImageId).toBe('uid-1');

        act(() => mockListeners.positionchange({ data: { imageUid: 'uid-0' } }));
        expect(sidebar.currentImageId).toBe('uid-0');
      });

      it('does nothing (and claims nothing) without a view layer', () => {
        renderWithList();
        expect(() => act(() => sidebar.jumpTo(0))).not.toThrow();
        expect(mockSetCurrentIndex).not.toHaveBeenCalled();
        expect(sidebar.currentImageId).toBeUndefined();
      });

      it.each([NaN, -1, 0.5])('never hands dwv an invalid index (%p)', (index) => {
        mockActiveViewLayer = {
          getViewController: () => ({
            getCurrentIndex: () => ({ getValues: () => [0, 0, 1] }),
            setCurrentIndex: mockSetCurrentIndex,
          }),
        };
        renderWithList();
        act(() => sidebar.jumpTo(index));
        expect(mockSetCurrentIndex).not.toHaveBeenCalled();
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

  describe('local import (standalone viewer only)', () => {
    it('is offered by the standalone viewer and hands one Series to dwv', async () => {
      render(<DicomViewer isClean />);
      await act(async () => undefined);
      expect(mockDropboxProps?.isShow).toBe(true);

      const files = [new File([new Uint8Array(4)], 'IM1')];
      act(() => mockDropboxProps?.onLoadFiles(files));

      const app = (jest.requireMock('dwv').App as jest.Mock).mock.results[0].value;
      expect(app.loadFiles).toHaveBeenCalledWith(files);
      // Hidden while dwv loads (Clean shows it again).
      expect(mockDropboxProps?.isShow).toBe(false);
    });

    it('is never offered by the Series review viewer', async () => {
      render(<DicomViewer list={urls} />);
      await act(async () => undefined);
      expect(mockDropboxProps?.isShow).toBe(false);
    });

    it('is not offered outside the standalone viewer, even without a list', async () => {
      render(<DicomViewer />);
      await act(async () => undefined);
      expect(mockDropboxProps?.isShow).toBe(false);
    });

    describe('failed and partial loads', () => {
      const appOf = () => (jest.requireMock('dwv').App as jest.Mock).mock.results[0].value;
      const filesOf = (count: number) =>
        Array.from({ length: count }, (_, i) => new File([new Uint8Array(4)], `IM${i + 1}`));
      /** Slice list the viewer hands to a custom sidebar (last render). */
      let sidebarItems: { imageUid: string }[] = [];
      /** The slice on screen as the sidebar gets it (last render). */
      let sidebarCurrent: string | undefined;
      /** Standalone viewer with one local stack handed to dwv. */
      const openStack = async (count = 3, dataid = '1') => {
        render(
          <DicomViewer
            isClean
            renderSidebar={({ items, currentImageId }) => {
              sidebarItems = items;
              sidebarCurrent = currentImageId;
              return null;
            }}
          />
        );
        await act(async () => undefined);
        const files = filesOf(count);
        act(() => {
          mockDropboxProps?.onLoadFiles(files);
          mockListeners.loadstart({ dataid });
        });
        return files;
      };
      /**
       * dwv 0.35 for an input it stored (`loaditem`, then `dataadd` for the
       * first slice or `dataupdate` once appended) or rejected (`loaditem`,
       * then `error` with that file as source: nothing stored).
       */
      const added = (dataid: string, file: File, uid: string, first = false) => {
        mockListeners.loaditem({ dataid, source: file, data: sopUid(uid) });
        mockDataIds.add(dataid);
        mockListeners[first ? 'dataadd' : 'dataupdate']({ dataid });
      };
      const rejected = (dataid: string, file: File, uid: string, message: string) => {
        mockListeners.loaditem({ dataid, source: file, data: sopUid(uid) });
        mockListeners.error({ dataid, source: file, error: new Error(message) });
      };

      beforeEach(() => {
        sidebarItems = [];
      });

      it('returns to the imported Series list when no image could be shown', async () => {
        const files = await openStack(2);
        mockImage = undefined;
        act(() => {
          rejected('1', files[0], 'uid-a', 'decode');
          rejected('1', files[1], 'uid-b', 'decode');
          mockListeners.loadend({ dataid: '1' });
        });

        expect(screen.getByText(/DICOM image stack could not be displayed/)).toBeTruthy();
        expect(mockDropboxProps?.isShow).toBe(true);
        expect(mockToolsProps?.isLoadSuccessful).toBe(false);
      });

      it('reports a load dwv gave up as a whole (error without a source)', async () => {
        await openStack(3);
        mockImage = undefined;
        act(() => {
          mockListeners.error({ dataid: '1', error: new Error('No loader found') });
          mockListeners.loadend({ dataid: '1' });
        });

        expect(screen.getByText(/DICOM image stack could not be displayed/)).toBeTruthy();
        expect(mockDropboxProps?.isShow).toBe(true);
      });

      it.each(['error', 'abort'])(
        'enables Clean after %s even without a loaded stack, and Clean shows the list',
        async (eventName) => {
          const files = await openStack();
          expect(mockToolsProps?.canClean).toBe(false);

          act(() => mockListeners[eventName]({ dataid: '1', source: files[0] }));
          runFrames();
          expect(mockToolsProps?.canClean).toBe(true);
          expect(mockDropboxProps?.isShow).toBe(false);

          act(() => mockToolsProps?.onClean?.());
          expect(mockAbortAllLoads).toHaveBeenCalled();
          expect(mockReset).toHaveBeenCalled();
          expect(mockDropboxProps?.isShow).toBe(true);
          expect(mockToolsProps?.canClean).toBe(false);
        }
      );

      // The order recorded from dwv 0.35.1's own loaders (synthetic slices,
      // the second with another row count): dwv reports the end of the
      // rejected file twice, so its overall loadend comes before the third
      // file was processed, which is appended afterwards.
      it('follows the slices dwv appends after its early loadend', async () => {
        const files = await openStack(3);
        mockImage = mockImageWithSlices(1);
        act(() => {
          added('1', files[0], 'uid-0', true);
          rejected('1', files[1], 'uid-x', 'Cannot append a slice with different number of rows');
          mockListeners.loadend({ dataid: '1' });
        });

        // Not (yet) reported as complete, nor as the final count.
        expect(screen.getByTestId('local-load-pending').textContent).toMatch(
          /Still adding images: 2 of 3 files processed \(1 image shown so far\)/
        );
        expect(screen.queryByTestId('local-load-incomplete')).toBeNull();
        expect(sidebarItems.map((i) => i.imageUid)).toEqual(['uid-0']);

        mockImage = mockImageWithSlices(2);
        act(() => added('1', files[2], 'uid-1'));
        runFrames();

        expect(screen.queryByTestId('local-load-pending')).toBeNull();
        expect(screen.getByTestId('local-load-incomplete').textContent).toMatch(
          /1 of 3 files could not be added, so this is not the complete Series \(2 images shown\)/
        );
        // Slice navigation and the sidebar follow the actual volume.
        expect(sidebarItems.map((i) => i.imageUid)).toEqual(['uid-0', 'uid-1']);
        expect(mockToolsProps?.isLoadSuccessful).toBe(false);
        expect(mockToolsProps?.canClean).toBe(true);
      });

      it('shows a stack whose first slice dwv adds only after its early loadend', async () => {
        const files = await openStack(3);
        mockImage = undefined;
        act(() => {
          rejected('1', files[0], 'uid-x', 'damaged');
          mockListeners.loadend({ dataid: '1' });
        });
        // Not a failure yet: two files are still being read.
        expect(screen.queryByText(/could not be displayed/)).toBeNull();
        expect(mockDropboxProps?.isShow).toBe(false);
        expect(screen.getByTestId('local-load-pending')).toBeTruthy();

        mockImage = mockImageWithSlices(1);
        act(() => added('1', files[1], 'uid-0', true));
        runFrames();
        mockImage = mockImageWithSlices(2);
        act(() => added('1', files[2], 'uid-1'));
        runFrames();

        expect(mockToolsProps?.isDataLoaded).toBe(true);
        expect(screen.getByTestId('local-load-incomplete').textContent).toMatch(
          /1 of 3 files could not be added.*\(2 images shown\)/
        );
        expect(sidebarItems).toHaveLength(2);
      });

      it('reports a complete stack without a warning', async () => {
        const files = await openStack(2);
        mockImage = mockImageWithSlices(2);
        act(() => {
          added('1', files[0], 'uid-0', true);
          added('1', files[1], 'uid-1');
          mockListeners.load({ dataid: '1' });
          mockListeners.loadend({ dataid: '1' });
        });
        expect(screen.queryByTestId('local-load-incomplete')).toBeNull();
        expect(screen.queryByTestId('local-load-pending')).toBeNull();
        expect(mockToolsProps?.isLoadSuccessful).toBe(true);
      });

      it('removes the previous stack first and ignores its late events', async () => {
        const files = await openStack(3, '1');
        act(() => added('1', files[0], 'uid-0', true));
        const app = appOf();
        mockReset.mockClear();
        mockAbortAllLoads.mockClear();

        act(() => {
          mockDropboxProps?.onLoadFiles(filesOf(2));
          mockListeners.loadstart({ dataid: '2' });
        });
        expect(mockAbortAllLoads).toHaveBeenCalledTimes(1);
        // Its data is removed from dwv, not only from the display.
        expect(mockAbortLoad).toHaveBeenCalledWith('1');
        expect(mockReset).toHaveBeenCalledTimes(1);
        expect(app.loadFiles).toHaveBeenCalledTimes(2);

        // The replaced load reports late (dwv cannot update removed data).
        act(() => {
          mockListeners.loaditem({ dataid: '1', source: files[1], data: sopUid('uid-old') });
          mockListeners.error({
            dataid: '1',
            source: files[1],
            error: new Error('Cannot find data to update: 1'),
          });
          mockListeners.abort({ dataid: '1' });
          mockListeners.loadend({ dataid: '1' });
        });
        expect(screen.queryByText(/could not be displayed/)).toBeNull();
        expect(mockToolsProps?.canClean).toBe(false);
        expect(mockDropboxProps?.isShow).toBe(false);

        mockImage = mockImageWithSlices(2);
        const next = filesOf(2);
        act(() => {
          added('2', next[0], 'uid-0', true);
          added('2', next[1], 'uid-1');
          mockListeners.load({ dataid: '2' });
          mockListeners.loadend({ dataid: '2' });
        });
        expect(mockToolsProps?.isLoadSuccessful).toBe(true);
        expect(screen.queryByTestId('local-load-incomplete')).toBeNull();
        expect(sidebarItems.map((i) => i.imageUid)).toEqual(['uid-0', 'uid-1']);
      });

      it('cleans a stack whose load still has pending slices after an early loadend', async () => {
        const files = await openStack(3, '1');
        act(() => {
          added('1', files[0], 'uid-0', true);
          rejected('1', files[1], 'uid-x', 'different orientation');
          mockListeners.loadend({ dataid: '1' });
        });

        act(() => mockToolsProps?.onClean?.());
        expect(mockAbortLoad).toHaveBeenCalledWith('1');
        expect(mockDataIds.size).toBe(0);
        expect(mockDropboxProps?.isShow).toBe(true);

        // dwv still reads the third file: it cannot reach the cleaned viewer.
        act(() => {
          mockListeners.loaditem({ dataid: '1', source: files[2], data: sopUid('uid-1') });
          mockListeners.error({
            dataid: '1',
            source: files[2],
            error: new Error('Cannot find data to update: 1'),
          });
        });
        runFrames();
        expect(screen.queryByTestId('local-load-pending')).toBeNull();
        expect(screen.queryByTestId('local-load-incomplete')).toBeNull();
        expect(mockToolsProps?.isDataLoaded).toBe(false);
        expect(mockToolsProps?.canClean).toBe(false);
        expect(mockDropboxProps?.isShow).toBe(true);
      });

      it('keeps no earlier Series in dwv when switching repeatedly', async () => {
        await openStack(1, '0');
        /** Opens Series `n` (the first one is already handed to dwv). */
        const openSeries = (n: number) => {
          const [file] = filesOf(1);
          if (n > 0) {
            mockDropboxProps?.onLoadFiles([file]);
            mockListeners.loadstart({ dataid: `${n}` });
          }
          added(`${n}`, file, `uid-${n}`, true);
          mockListeners.loadend({ dataid: `${n}` });
        };
        for (let n = 0; n < 5; n++) {
          act(() => openSeries(n));
          // Only the Series on screen is held.
          expect([...mockDataIds]).toEqual([`${n}`]);
        }
        expect(mockAbortLoad.mock.calls.map(([id]) => id)).toEqual(['0', '1', '2', '3']);
      });

      it('frees the shown Series when the viewer is removed', async () => {
        const files = await openStack(1, '1');
        act(() => {
          added('1', files[0], 'uid-0', true);
          mockListeners.loadend({ dataid: '1' });
        });
        cleanup();
        expect(mockAbortLoad).toHaveBeenCalledWith('1');
        expect(mockDataIds.size).toBe(0);
      });

      it('ignores events the aborted load emits synchronously while being removed', async () => {
        await openStack(3, '1');
        mockAbortAllLoads.mockImplementationOnce(() => {
          mockListeners.abort({ dataid: '1' });
          mockListeners.loadend({ dataid: '1' });
        });
        mockImage = undefined;
        act(() => mockToolsProps?.onClean?.());

        expect(screen.queryByText(/could not be displayed/)).toBeNull();
        expect(mockDropboxProps?.isShow).toBe(true);
        expect(mockToolsProps?.canClean).toBe(false);
      });

      it('shows the list again when dwv refuses the files', async () => {
        render(<DicomViewer isClean />);
        await act(async () => undefined);
        appOf().loadFiles.mockImplementationOnce(() => {
          throw new Error('No loader found');
        });

        act(() => mockDropboxProps?.onLoadFiles(filesOf(1)));

        expect(screen.getByText(/could not be displayed. Choose another Series/)).toBeTruthy();
        expect(mockDropboxProps?.isShow).toBe(true);
      });

      /**
       * dwv 0.35 with an image that grows as it stores slices: a metadata
       * merge failure (duplicate or missing Instance Numbers) comes after
       * the slice was appended, as an `error` instead of `dataupdate`.
       */
      describe('images dwv stored, and errors after storing them', () => {
        let slices = 0;
        const getImageUid = jest.fn((index: { values: number[] }) => `uid-${index.values[2]}`);
        const store = (dataid: string, file: File, mergeError?: string) => {
          mockListeners.loaditem({ dataid, source: file, data: sopUid(`uid-${slices}`) });
          slices++;
          mockDataIds.add(dataid);
          if (mergeError) {
            mockListeners.error({ dataid, source: file, error: new Error(mergeError) });
          } else {
            mockListeners[slices === 1 ? 'dataadd' : 'dataupdate']({ dataid });
          }
        };
        const shownErrors = () =>
          (mockToolsProps as unknown as { loadErrorEvents: object[] }).loadErrorEvents;

        beforeEach(() => {
          slices = 0;
          getImageUid.mockClear();
          mockImage = {
            getGeometry: () => ({
              getSize: () => ({ get: () => slices, getTotalSize: () => slices }),
            }),
            getImageUid,
          };
        });

        it.each([
          // As recorded from dwv 0.35.1 for Instance Numbers 1,1,2,2.
          [
            'duplicate Instance Numbers',
            ['', 'Cannot merge object with same ids: 1, id2: 1', '', 'The first object already contains id2: 2, id1: 1,2'],
            2,
          ],
          // And for four slices without Instance Numbers.
          ['missing Instance Numbers', ['', ...Array(3).fill('Cannot merge object with same ids: , id2: ')], 3],
        ])(
          'shows every stored image and reports %s as metadata errors, not missing images',
          async (_, mergeErrors, metadataFiles) => {
            const files = await openStack(4);
            act(() => {
              files.forEach((file, i) => store('1', file, mergeErrors[i] || undefined));
              mockListeners.loadend({ dataid: '1' });
            });

            expect(screen.queryByTestId('local-load-incomplete')).toBeNull();
            expect(screen.queryByTestId('local-load-pending')).toBeNull();
            expect(screen.getByTestId('local-load-metadata-errors').textContent).toMatch(
              new RegExp(`the images of ${metadataFiles} files were added and are shown`)
            );
            // dwv's actual image: 4 slices, all in the slice list.
            expect(sidebarItems).toHaveLength(4);
            // The errors are kept and reported, never a successful load.
            expect(shownErrors()).toHaveLength(metadataFiles);
            expect(shownErrors()[0]).toMatchObject({ category: 'metadata' });
            expect(mockToolsProps?.isLoadSuccessful).toBe(false);
          }
        );

        it('reports missing images and metadata errors separately', async () => {
          const files = await openStack(4);
          act(() => {
            store('1', files[0]);
            store('1', files[1], 'Cannot merge object with same ids: 1, id2: 1');
            rejected('1', files[2], 'uid-x', 'Cannot append a slice with different number of rows');
            mockListeners.loadend({ dataid: '1' });
          });
          act(() => store('1', files[3]));
          runFrames();

          expect(screen.getByTestId('local-load-incomplete').textContent).toMatch(
            /1 of 4 files could not be added.*\(3 images shown\)/
          );
          expect(screen.getByTestId('local-load-metadata-errors').textContent).toMatch(
            /the images of 1 file were added/
          );
        });

        it('counts a file with several errors once', async () => {
          const files = await openStack(3);
          act(() => {
            store('1', files[0]);
            rejected('1', files[1], 'uid-x', 'Cannot append a slice with different number of rows');
            mockListeners.error({ dataid: '1', source: files[1], error: new Error('again') });
            mockListeners.loadend({ dataid: '1' });
          });
          // Two errors, but the third file is still being added.
          expect(screen.getByTestId('local-load-pending').textContent).toMatch(
            /2 of 3 files processed/
          );

          act(() => store('1', files[2]));
          runFrames();
          expect(screen.getByTestId('local-load-incomplete').textContent).toMatch(
            /1 of 3 files could not be added/
          );
        });

        it('names failed inputs by position, never by URL (token, patient ids)', async () => {
          const signed = [
            '/api/v1/patients/p1/images/i1/file?token=secret',
            '/api/v1/patients/p1/images/i2/file?token=secret',
          ];
          render(<DicomViewer list={signed} />);
          await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
          act(() => {
            mockListeners.loadstart({ dataid: '0' });
            mockListeners.error({
              dataid: '0',
              source: signed[1],
              error: `GET https://host${signed[1]} 503 (Service Unavailable)`,
            });
          });
          runFrames();
          expect(shownErrors()).toEqual([
            expect.objectContaining({ source: 'Input 2 of 2', detail: 'HTTP 503.' }),
          ]);
          expect(JSON.stringify(shownErrors())).not.toMatch(/token|secret|patients|p1/);
        });

        it('ignores progress of a load that was cleaned or replaced', async () => {
          await openStack(3, '1');
          const progressBars = () => screen.queryAllByRole('progressbar');
          act(() => mockListeners.loadprogress({ dataid: '1', loaded: 40 }));
          expect(progressBars()).toHaveLength(1);

          // dwv still reads files it no longer tracks after an early loadend.
          act(() => mockToolsProps?.onClean?.());
          act(() => mockListeners.loadprogress({ dataid: '1', loaded: 60 }));
          expect(progressBars()).toHaveLength(0);

          act(() => {
            mockDropboxProps?.onLoadFiles(filesOf(2));
            mockListeners.loadstart({ dataid: '2' });
            mockListeners.loadprogress({ dataid: '1', loaded: 80 });
          });
          expect(progressBars()).toHaveLength(0);
          act(() => mockListeners.loadprogress({ dataid: '2', loaded: 50 }));
          expect(progressBars()).toHaveLength(1);
        });

        it('ignores a position change between Clean and the next load', async () => {
          const files = await openStack(1, '1');
          act(() => {
            store('1', files[0]);
            mockListeners.loadend({ dataid: '1' });
          });
          act(() => mockListeners.positionchange({ data: { imageUid: 'uid-0' } }));
          expect(sidebarCurrent).toBe('uid-0');

          act(() => mockToolsProps?.onClean?.());
          act(() => mockListeners.positionchange({ data: { imageUid: 'uid-0' } }));
          expect(sidebarCurrent).toBeUndefined();

          // The next load's slices are followed again.
          const next = filesOf(1);
          act(() => {
            mockDropboxProps?.onLoadFiles(next);
            mockListeners.loadstart({ dataid: '2' });
            mockListeners.positionchange({ data: { imageUid: 'uid-0' } });
          });
          expect(sidebarCurrent).toBe('uid-0');
        });

        it('never shows the patient values of dwv error messages', async () => {
          const files = await openStack(2);
          act(() => {
            store('1', files[0]);
            rejected(
              '1',
              files[1],
              'uid-x',
              'Cannot append a slice with different PatientName: SYNTHETIC^ALICE != SYNTHETIC^BOB'
            );
            mockListeners.loadend({ dataid: '1' });
          });
          const shown = JSON.stringify(shownErrors());
          expect(shown).toContain('Different PatientName (values not shown).');
          expect(shown).not.toMatch(/ALICE|BOB/);
          expect(document.body.textContent).not.toMatch(/ALICE|BOB/);
        });

        it('reports metadata errors to the Series review (never a complete load)', () => {
          const onLoadResult = jest.fn();
          render(<DicomViewer list={urls} onLoadResult={onLoadResult} />);
          act(() => {
            mockListeners.loadstart({ dataid: '0' });
            store('0', urls[0] as unknown as File);
            store('0', urls[1] as unknown as File, 'Cannot merge object with same ids: 1, id2: 1');
            mockListeners.loadend({ dataid: '0' });
          });
          expect(onLoadResult).toHaveBeenLastCalledWith({
            sliceCount: 2,
            errorCount: 1,
            metadataErrorCount: 1,
            loadedSources: urls,
          });
        });

        describe('slices dwv adds after its early loadend', () => {
          /** 1 stored slice, 1 rejected, dwv's early loadend; `count` files. */
          const startLargeStack = async (count: number) => {
            const files = await openStack(count);
            act(() => {
              store('1', files[0]);
              rejected('1', files[1], 'uid-x', 'Cannot append a slice with different number of rows');
              mockListeners.loadend({ dataid: '1' });
            });
            return files;
          };

          it('re-reads the stack once per frame, however many slices arrive', async () => {
            const files = await startLargeStack(302);
            getImageUid.mockClear();
            const frames = (window.requestAnimationFrame as jest.Mock).mock.calls.length;

            act(() => files.slice(2).forEach((file) => store('1', file)));
            // 300 slices stored: one frame requested, nothing re-read yet.
            expect((window.requestAnimationFrame as jest.Mock).mock.calls.length).toBe(frames + 1);
            expect(getImageUid).not.toHaveBeenCalled();

            runFrames();
            // One reconciliation: every slice UID read once.
            expect(getImageUid).toHaveBeenCalledTimes(301);
            expect(sidebarItems).toHaveLength(301);
            expect(screen.getByTestId('local-load-incomplete').textContent).toMatch(
              /1 of 302 files could not be added.*\(301 images shown\)/
            );
          });

          it('shows the final stack when the last slices come in a later frame', async () => {
            const files = await startLargeStack(6);
            act(() => store('1', files[2]));
            runFrames();
            expect(screen.getByTestId('local-load-pending')).toBeTruthy();

            act(() => files.slice(3).forEach((file) => store('1', file)));
            runFrames();
            expect(screen.queryByTestId('local-load-pending')).toBeNull();
            expect(sidebarItems).toHaveLength(5);
            expect(mockFrames.size).toBe(0);
          });

          it.each(['Clean', 'replacing the Series', 'unmount'])(
            'drops a scheduled update on %s; a late frame changes nothing',
            async (action) => {
              const files = await startLargeStack(4);
              act(() => store('1', files[2]));
              const scheduled = [...mockFrames.values()];
              expect(scheduled).toHaveLength(1);
              expect(sidebarItems).toHaveLength(1);

              if (action === 'Clean') act(() => mockToolsProps?.onClean?.());
              if (action === 'replacing the Series') {
                act(() => {
                  mockDropboxProps?.onLoadFiles(filesOf(2));
                  mockListeners.loadstart({ dataid: '2' });
                });
              }
              if (action === 'unmount') cleanup();
              expect(window.cancelAnimationFrame).toHaveBeenCalled();
              expect(mockFrames.size).toBe(0);
              // Its data is gone from dwv (no frame keeps it).
              expect(mockDataIds.has('1')).toBe(false);

              getImageUid.mockClear();
              act(() => scheduled.forEach((frame) => frame(0)));
              expect(getImageUid).not.toHaveBeenCalled();
              if (action !== 'unmount') {
                expect(sidebarItems).toEqual([]);
                expect(mockToolsProps?.isDataLoaded).toBe(false);
                expect(screen.queryByTestId('local-load-pending')).toBeNull();
                expect(screen.queryByTestId('local-load-incomplete')).toBeNull();
              }
            }
          );
        });
      });
    });
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

    it('draws the Ruler without end ticks on every draw layer dwv adds (Issue #68)', () => {
      render(<DicomViewer list={urls} />);
      /** A draw layer's Konva layer: a ruler and its two end ticks. */
      const rulerLayer = () => {
        const group = { name: () => 'ruler-group' };
        const ticks = [0, 1].map(() => {
          let visible = true;
          return {
            name: () => 'tick',
            getParent: () => group,
            visible: (value?: boolean) => (value === undefined ? visible : (visible = value)),
          };
        });
        return {
          ticks,
          find: jest.fn(() => ticks),
          on: jest.fn(),
          off: jest.fn(),
          batchDraw: jest.fn(),
        };
      };
      const first = rulerLayer();
      mockDrawLayers = [{ getKonvaLayer: () => first }];

      act(() => mockListeners.drawlayeradd({ layerid: '1', dataid: '0' }));
      expect(first.on).toHaveBeenCalledWith('beforeDraw.rulerEndTicks', expect.any(Function));
      expect(first.ticks.map((tick) => tick.visible())).toEqual([false, false]);

      // Another stack (or layer group): one listener per layer.
      const second = rulerLayer();
      mockDrawLayers = [...mockDrawLayers, { getKonvaLayer: () => second }];
      act(() => mockListeners.drawlayeradd({ layerid: '2', dataid: '1' }));
      expect(second.on).toHaveBeenCalledTimes(1);
      expect(first.off).toHaveBeenLastCalledWith('beforeDraw.rulerEndTicks');
      expect(second.ticks.map((tick) => tick.visible())).toEqual([false, false]);
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

  describe('custom slice list', () => {
    /** Counts its mounts and keeps local state (e.g. a selection). */
    let probeMounts = 0;
    const Probe = ({ label }: { label: string }) => {
      const [state] = useState(() => ++probeMounts);
      return <div data-testid="custom-sidebar">{`${label}:${state}`}</div>;
    };
    beforeEach(() => {
      probeMounts = 0;
    });

    it('stays mounted when its render function changes (e.g. collapsed)', () => {
      const { rerender } = render(
        <DicomViewer list={urls} renderSidebar={() => <Probe label="expanded" />} />
      );
      rerender(<DicomViewer list={urls} renderSidebar={() => <Probe label="collapsed" />} />);
      rerender(<DicomViewer list={urls} renderSidebar={() => <Probe label="expanded" />} />);
      expect(screen.getByTestId('custom-sidebar').textContent).toBe('expanded:1');
      expect(probeMounts).toBe(1);
      expect(jest.requireMock('dwv').App).toHaveBeenCalledTimes(1);
    });

    const flexDirection = () =>
      getComputedStyle(screen.getByTestId('dicom-viewport-row')).flexDirection;

    /** CSS order of each slot of the viewport row. */
    const slotOrder = (testId: string) => getComputedStyle(screen.getByTestId(testId)).order;

    it('sits next to the viewport by default, not over it', () => {
      render(<DicomViewer list={urls} renderSidebar={() => <Probe label="list" />} />);
      const viewport = screen.getByTestId('dicom-viewport');
      const row = screen.getByTestId('dicom-viewport-row');
      expect(row.contains(screen.getByTestId('custom-sidebar'))).toBe(true);
      expect(viewport.contains(screen.getByTestId('custom-sidebar'))).toBe(false);
      expect(flexDirection()).toBe('row');
      expect(screen.queryByTestId('default-sidebar')).toBeNull();
    });

    it('centres the toolbar over the viewport only, between the two panels', () => {
      render(
        <DicomViewer
          list={urls}
          toolbar={<div data-testid="custom-toolbar" />}
          leadingPanel={<div data-testid="leading-panel" />}
          renderSidebar={() => <Probe label="list" />}
        />
      );
      const main = screen.getByTestId('dicom-viewer-main');
      // The toolbar's column is exactly the viewport's column...
      expect(main.contains(screen.getByTestId('viewer-tools'))).toBe(true);
      expect(main.contains(screen.getByTestId('custom-toolbar'))).toBe(true);
      expect(main.contains(screen.getByTestId('dicom-viewport'))).toBe(true);
      expect(getComputedStyle(screen.getByTestId('dicom-viewport')).width).toBe('100%');
      // ...and the panels are outside it, on both sides.
      expect(main.contains(screen.getByTestId('leading-panel'))).toBe(false);
      expect(main.contains(screen.getByTestId('custom-sidebar'))).toBe(false);
      expect(getComputedStyle(main).flexGrow).toBe('1');
      expect([slotOrder('dicom-viewer-leading'), slotOrder('dicom-viewer-main'), slotOrder('dicom-viewer-sidebar')]).toEqual(['0', '1', '2']);
      // Panels are as high as the toolbar and viewport (stretched, no own height).
      expect(getComputedStyle(screen.getByTestId('dicom-viewport-row')).height).toBe('');
      expect(getComputedStyle(screen.getByTestId('dicom-viewport-row')).alignItems).not.toBe('flex-start');
    });

    it('below: viewport first, then the sidebar, then the leading panel; nothing remounts', () => {
      const LeadingProbe = () => {
        const [state] = useState(() => ++probeMounts);
        return <div data-testid="leading-panel">{state}</div>;
      };
      const view = (placement: 'beside' | 'below') => (
        <DicomViewer
          list={urls}
          leadingPanel={<LeadingProbe />}
          renderSidebar={() => <Probe label="list" />}
          sidebarPlacement={placement}
        />
      );
      const { rerender } = render(view('beside'));
      rerender(view('below'));
      expect(flexDirection()).toBe('column');
      expect([slotOrder('dicom-viewer-main'), slotOrder('dicom-viewer-sidebar'), slotOrder('dicom-viewer-leading')]).toEqual(['1', '2', '3']);
      // The toolbar is still centred over the (now full-width) viewport.
      expect(screen.getByTestId('dicom-viewer-main').contains(screen.getByTestId('viewer-tools'))).toBe(true);
      rerender(view('beside'));
      expect(flexDirection()).toBe('row');
      expect(probeMounts).toBe(2); // one sidebar, one leading panel: never remounted
      expect(jest.requireMock('dwv').App).toHaveBeenCalledTimes(1);
    });

    it('goes below a full-width viewport on request, without remounting', () => {
      const { rerender } = render(
        <DicomViewer list={urls} renderSidebar={() => <Probe label="list" />} />
      );
      rerender(
        <DicomViewer
          list={urls}
          renderSidebar={() => <Probe label="list" />}
          sidebarPlacement="below"
        />
      );
      expect(flexDirection()).toBe('column');
      expect(getComputedStyle(screen.getByTestId('dicom-viewport')).width).toBe('100%');
      rerender(
        <DicomViewer
          list={urls}
          renderSidebar={() => <Probe label="list" />}
          sidebarPlacement="beside"
        />
      );
      expect(flexDirection()).toBe('row');
      expect(probeMounts).toBe(1);
      expect(jest.requireMock('dwv').App).toHaveBeenCalledTimes(1);
      expect(mockLoadURLs.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('without one and nothing loaded, the viewport is full width (DWV page import)', () => {
      render(<DicomViewer isClean />);
      expect(flexDirection()).toBe('column');
      expect(getComputedStyle(screen.getByTestId('dicom-viewport')).width).toBe('100%');
      // No panel slots: the toolbar is centred over the full-width viewport.
      expect(screen.queryByTestId('default-sidebar')).toBeNull();
      expect(screen.queryByTestId('dicom-viewer-image-list')).toBeNull();
      expect(screen.queryByTestId('dicom-viewer-leading')).toBeNull();
      expect(screen.queryByTestId('dicom-viewer-sidebar')).toBeNull();
      expect(screen.getByTestId('dicom-viewer-main').contains(screen.getByTestId('viewer-tools'))).toBe(true);
    });

    it('is still rendered on small screens; the default file list is not', () => {
      // Every media query matches: the smallest breakpoint.
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: true,
        media: query,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
      })) as never;
      const { unmount } = render(
        <DicomViewer list={urls} renderSidebar={() => <Probe label="list" />} />
      );
      expect(screen.getByTestId('custom-sidebar')).toBeTruthy();
      unmount();

      render(<DicomViewer list={urls} />);
      act(() => mockListeners.loadend({ dataid: '0' }));
      expect(mockSidebarProps).toBeNull();
      expect(screen.queryByTestId('default-sidebar')).toBeNull();
    });
  });

  /** The standalone (DWV page) viewer's own image list. */
  describe('default image list', () => {
    const appOf = () => (jest.requireMock('dwv').App as jest.Mock).mock.results[0].value;
    /** Standalone viewer showing a local stack of `count` slices. */
    const openStack = async (count = 3) => {
      mockImage = mockImageWithSlices(count);
      const view = render(<DicomViewer isClean />);
      await act(async () => undefined);
      const files = Array.from(
        { length: count },
        (_, i) => new File([new Uint8Array(4)], `IM${i + 1}`)
      );
      act(() => {
        mockDropboxProps?.onLoadFiles(files);
        mockListeners.loadstart({ dataid: '1' });
        files.forEach((file, i) =>
          mockListeners.loaditem({ dataid: '1', source: file, data: sopUid(`uid-${i}`) })
        );
        mockListeners.loadend({ dataid: '1' });
      });
      runFrames();
      return view;
    };
    const toggle = () => act(() => mockSidebarProps?.onToggle());
    const flexDirection = () =>
      getComputedStyle(screen.getByTestId('dicom-viewport-row')).flexDirection;

    beforeEach(() => {
      mockSidebarProps = null;
    });

    it('sits next to the viewport (in the row, not fixed over the image), expanded', async () => {
      await openStack();
      const slot = screen.getByTestId('dicom-viewer-image-list');
      expect(flexDirection()).toBe('row');
      expect(screen.getByTestId('dicom-viewport-row').contains(slot)).toBe(true);
      expect(screen.getByTestId('dicom-viewport').contains(slot)).toBe(false);
      expect(slot.contains(screen.getByTestId('default-sidebar'))).toBe(true);
      expect(getComputedStyle(slot).flexShrink).toBe('0');
      // The viewport's column takes the rest of the row's width.
      expect(getComputedStyle(screen.getByTestId('dicom-viewer-main')).flexGrow).toBe('1');
      expect(getComputedStyle(screen.getByTestId('dicom-viewport')).width).toBe('100%');
      expect([
        getComputedStyle(screen.getByTestId('dicom-viewer-main')).order,
        getComputedStyle(slot).order,
      ]).toEqual(['1', '2']);
      expect(mockSidebarProps?.expanded).toBe(true);
      expect(mockSidebarProps?.items.map(({ index }) => index)).toEqual([0, 1, 2]);
    });

    it('collapses and expands without a new dwv App, load, reset or tool change', async () => {
      await openStack();
      const app = appOf();
      /** dwv calls that would reset or replace what is shown. */
      const resets = () =>
        [mockReset, mockAbortAllLoads, mockAbortLoad, mockResetZoomPan, mockSetTool].map(
          (mock) => mock.mock.calls.length
        );
      // Counted after the load (importing removes the previous stack first).
      const before = resets();
      const current = mockSidebarProps?.currentImageId;
      expect(current).toBe('uid-2');

      for (let i = 0; i < 3; i++) {
        toggle();
        expect(mockSidebarProps?.expanded).toBe(false);
        // Still in the row (its compact control), the viewport still beside it.
        expect(screen.getByTestId('default-sidebar').dataset.expanded).toBe('false');
        expect(flexDirection()).toBe('row');
        toggle();
        expect(mockSidebarProps?.expanded).toBe(true);
      }

      expect(jest.requireMock('dwv').App).toHaveBeenCalledTimes(1);
      expect(app.loadFiles).toHaveBeenCalledTimes(1);
      expect(mockLoadURLs).not.toHaveBeenCalled();
      expect(resets()).toEqual(before);
      expect(mockSidebarProps?.currentImageId).toBe(current);
      expect(mockToolsProps?.isDataLoaded).toBe(true);
    });

    it('asks dwv for the slice the list jumps to, collapsed in between', async () => {
      mockActiveViewLayer = {
        getViewController: () => ({
          getCurrentIndex: () => ({ getValues: () => [0, 0, 2] }),
          setCurrentIndex: mockSetCurrentIndex,
        }),
      };
      await openStack();
      toggle();
      toggle();
      act(() => mockSidebarProps?.onJumpTo(1));
      expect(mockSetCurrentIndex).toHaveBeenCalledTimes(1);
      expect(mockSetCurrentIndex.mock.calls[0][0].values).toEqual([0, 0, 1]);
      act(() => mockListeners.positionchange({ data: { imageUid: 'uid-1' } }));
      expect(mockSidebarProps?.currentImageId).toBe('uid-1');
    });

    it('is not used by the Series review viewer (custom list)', async () => {
      render(<DicomViewer list={urls} renderSidebar={() => <div data-testid="custom" />} />);
      act(() => mockListeners.loadend({ dataid: '0' }));
      expect(screen.getByTestId('custom')).toBeTruthy();
      expect(mockSidebarProps).toBeNull();
      expect(screen.queryByTestId('dicom-viewer-image-list')).toBeNull();
    });

    it('is gone again after Clean (full-width import)', async () => {
      await openStack();
      act(() => mockToolsProps?.onClean?.());
      expect(screen.queryByTestId('dicom-viewer-image-list')).toBeNull();
      expect(flexDirection()).toBe('column');
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

    it('refits in place when the viewport is resized (e.g. a side panel collapsed)', async () => {
      let resize: () => void = () => undefined;
      (window as { ResizeObserver?: unknown }).ResizeObserver = jest
        .fn()
        .mockImplementation((callback: () => void) => {
          resize = () => act(() => callback());
          return { observe: jest.fn(), disconnect: jest.fn() };
        });
      try {
        sizeViewport(800, 600);
        setPixelRatio(2);
        const { App } = jest.requireMock('dwv');
        render(<DicomViewer list={urls} />);
        await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
        act(() => mockListeners.loadend({ dataid: '0' }));
        const toolCalls = mockSetTool.mock.calls.length;
        const fits = mockFitToContainer.mock.calls.length;
        expect(fits).toBeGreaterThan(0);

        // The viewport gets the width of a collapsed panel.
        sizeViewport(1070, 600);
        resize();

        const container = document.getElementById('layerGroup0') as HTMLElement;
        expect(container.style.width).toBe('2140px');
        expect(container.style.height).toBe('1200px');
        expect(container.style.transform).toBe('scale(0.5)');
        expect(mockFitToContainer).toHaveBeenCalledTimes(fits + 1);
        // An untouched (fitted) view follows the viewport; nothing resets
        // zoom/pan, the tool, the drawings or the loaded data.
        expect(mockResetZoomPan).not.toHaveBeenCalled();
        expect(mockReset).not.toHaveBeenCalled();
        expect(mockAbortAllLoads).not.toHaveBeenCalled();
        expect(mockSetTool).toHaveBeenCalledTimes(toolCalls);
        expect(mockLoadURLs).toHaveBeenCalledTimes(1);
        expect(App).toHaveBeenCalledTimes(1);
        expect(mockToolsProps?.isDataLoaded).toBe(true);
      } finally {
        delete (window as { ResizeObserver?: unknown }).ResizeObserver;
      }
    });

    /**
     * The user's zoom/pan on resize (`DicomViewer.refit` has the geometry).
     * dwv's layer group reports zoom and pan changes (`zoomchange`,
     * `offsetchange`), as dwv forwards them to the App; its fit changes
     * the plane units per canvas pixel (`unitsPerPixel`).
     */
    describe('zoom and pan set by the user', () => {
      let resize: () => void = () => undefined;
      const view = { unitsPerPixel: 1 };
      const emit = (type: string) => mockListeners[type]?.({ type });
      const point = (x: number, y: number) => ({ getX: () => x, getY: () => y });
      const createLayerGroup = () => {
        const viewController = {
          getImageSize: () => ({ get: () => 512 }),
          get2DSpacing: () => ({ x: 1, y: 1 }),
          getPlanePositionFromPlanePoint: jest.fn(() => ({})),
          getOffset3DFromPlaneOffset: ({ x, y }: { x: number; y: number }) => ({
            getX: () => x,
            getY: () => y,
            getZ: () => 0,
          }),
        };
        const toPlane = (p: { getX(): number; getY(): number }) =>
          point(p.getX() * view.unitsPerPixel, p.getY() * view.unitsPerPixel);
        const layer = {
          getViewController: () => viewController,
          displayToPlaneScale: toPlane,
          displayToPlanePos: toPlane,
          displayToMainPlanePos: toPlane,
        };
        return {
          setActiveLayer: jest.fn(),
          getActiveViewLayer: () => undefined,
          getBaseViewLayer: () => layer,
          getScale: () => ({ x: 2, y: 2, z: 2 }),
          setScale: jest.fn(() => emit('zoomchange')),
          addScale: jest.fn(() => emit('zoomchange')),
          addTranslation: jest.fn(() => emit('offsetchange')),
          draw: jest.fn(),
        };
      };
      let group: ReturnType<typeof createLayerGroup>;
      const appOf = () => (jest.requireMock('dwv').App as jest.Mock).mock.results[0].value;
      /** The standalone viewer showing a local stack in an 800 x 600 viewport. */
      const openStack = async () => {
        render(<DicomViewer isClean />);
        await act(async () => undefined);
        act(() => {
          mockDropboxProps?.onLoadFiles([new File([new Uint8Array(4)], 'IM1')]);
          mockListeners.loadstart({ dataid: '1' });
          mockListeners.loadend({ dataid: '1' });
        });
      };
      /** The Series review viewer (custom panels), same viewport. */
      const openReview = async () => {
        render(
          <DicomViewer
            list={urls}
            leadingPanel={<div />}
            renderSidebar={() => <div />}
          />
        );
        await waitFor(() => expect(mockLoadURLs).toHaveBeenCalledTimes(1));
        act(() => mockListeners.loadend({ dataid: '0' }));
      };
      /** dwv calls that reset, replace or reload what is shown. */
      const resetsAndLoads = () =>
        [
          mockReset,
          mockAbortAllLoads,
          mockAbortLoad,
          mockResetZoomPan,
          mockSetTool,
          mockLoadURLs,
          appOf().loadFiles,
        ].map((mock: jest.Mock) => mock.mock.calls.length);
      /** The viewport gets wider (a panel collapsed); dwv's fit grows. */
      const widen = () => {
        mockFitToContainer.mockImplementationOnce(() => {
          view.unitsPerPixel = 0.8;
        });
        sizeViewport(1000, 600);
        resize();
      };

      beforeEach(() => {
        view.unitsPerPixel = 1;
        group = createLayerGroup();
        mockLayerGroup = group;
        (window as { ResizeObserver?: unknown }).ResizeObserver = jest
          .fn()
          .mockImplementation((callback: () => void) => {
            resize = () => act(() => callback());
            return { observe: jest.fn(), disconnect: jest.fn() };
          });
        sizeViewport(800, 600);
      });
      afterEach(() => {
        delete (window as { ResizeObserver?: unknown }).ResizeObserver;
      });

      it('standalone: keeps their magnification and centre, without a reload or reset', async () => {
        await openStack();
        // Counted after the load (importing removes the previous stack first).
        const before = resetsAndLoads();
        const fits = mockFitToContainer.mock.calls.length;
        act(() => emit('zoomchange')); // e.g. the wheel or the Zoom tool

        widen();

        expect(mockFitToContainer).toHaveBeenCalledTimes(fits + 1);
        // dwv's fit grew by 1 / 0.8: the zoom relative to it shrinks by 0.8.
        expect(group.setScale).toHaveBeenCalledWith({ x: 1.6, y: 1.6, z: 1.6 });
        // The image point at the old centre (400, 300 at 1 unit/pixel) is
        // panned to the new one: by what is there now (500, 300 at 0.8
        // units/pixel, i.e. 400, 240) minus it.
        expect(group.addTranslation).toHaveBeenCalledWith({ x: 0, y: -60, z: 0 });
        expect(group.draw).toHaveBeenCalled();
        expect(resetsAndLoads()).toEqual(before);
        expect(jest.requireMock('dwv').App).toHaveBeenCalledTimes(1);
      });

      it('standalone: keeps "Actual pixels" (1:1) across the resize', async () => {
        jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
        jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
        await openStack();
        act(() => mockToolsProps?.onActualPixels());
        // 512 image pixels in 600 canvas pixels: zoom 512 / 600 of the fit.
        expect(group.addScale).toHaveBeenCalledWith(512 / 600 - 1, expect.anything());

        widen();

        expect(group.setScale).toHaveBeenCalledTimes(1);
        expect(group.addTranslation).toHaveBeenCalledTimes(1);
      });

      /** Refitted by dwv alone (zoom relative to the fit), nothing kept. */
      const expectPlainRefit = (fits: number) => {
        expect(mockFitToContainer).toHaveBeenCalledTimes(fits + 1);
        expect(group.setScale).not.toHaveBeenCalled();
        expect(group.addTranslation).not.toHaveBeenCalled();
      };

      it('standalone: an untouched (fitted) view follows the viewport', async () => {
        await openStack();
        const fits = mockFitToContainer.mock.calls.length;
        widen();
        expectPlainRefit(fits);
      });

      it('standalone: a view reset after a pan follows the viewport', async () => {
        await openStack();
        act(() => emit('offsetchange')); // panned...
        mockResetZoomPan.mockImplementationOnce(() => {
          emit('zoomchange');
          emit('offsetchange');
        });
        act(() => mockToolsProps?.onReset()); // ...and reset
        const fits = mockFitToContainer.mock.calls.length;

        widen();

        expectPlainRefit(fits);
      });

      it('Series review: keeps dwv\'s own refit, even after zoom and pan', async () => {
        await openReview();
        const before = resetsAndLoads();
        act(() => {
          emit('zoomchange');
          emit('offsetchange');
        });
        const fits = mockFitToContainer.mock.calls.length;

        widen();

        expectPlainRefit(fits);
        expect(resetsAndLoads()).toEqual(before);
        expect(jest.requireMock('dwv').App).toHaveBeenCalledTimes(1);
      });
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
