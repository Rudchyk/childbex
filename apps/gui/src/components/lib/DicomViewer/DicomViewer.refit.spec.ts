/**
 * Refitting dwv to a resized container keeps the magnification on screen
 * ("Actual pixels" 1:1 included) and the image point at the centre. dwv is
 * replaced by a model of its 0.35 view transform: a layer shows plane
 * position `display / (fit * zoom) + offset`; `fitToContainer` changes the
 * fit (and the offset), keeping the zoom relative to the fit.
 */
import type { App } from 'dwv';
import { refitKeepingView } from './DicomViewer.refit';

jest.mock('dwv', () => ({
  Point2D: jest.fn().mockImplementation(function (
    this: { getX: () => number; getY: () => number },
    x: number,
    y: number
  ) {
    this.getX = () => x;
    this.getY = () => y;
  }),
}));

interface Pt {
  getX(): number;
  getY(): number;
}
const pt = (x: number, y: number): Pt => ({ getX: () => x, getY: () => y });

/**
 * One layer group with one view layer: `fit` canvas pixels per plane unit
 * at zoom 1, the group's `zoom` (relative to the fit) and `offset` (plane
 * position at display 0,0). Plane and world offsets are the same here.
 */
const createView = (fit: number, zoom: number, offset: { x: number; y: number }) => {
  const state = { fit, zoom, offset: { ...offset } };
  const scale = () => state.fit * state.zoom;
  const layer = {
    displayToPlaneScale: (p: Pt) => pt(p.getX() / scale(), p.getY() / scale()),
    displayToPlanePos: (p: Pt) =>
      pt(p.getX() / scale() + state.offset.x, p.getY() / scale() + state.offset.y),
    getViewController: () => ({
      getOffset3DFromPlaneOffset: ({ x, y }: { x: number; y: number }) => ({
        getX: () => x,
        getY: () => y,
        getZ: () => 0,
      }),
    }),
  };
  const group = {
    getBaseViewLayer: () => layer,
    getScale: () => ({ x: state.zoom, y: state.zoom, z: state.zoom }),
    setScale: jest.fn((s: { x: number }) => {
      state.zoom = s.x;
    }),
    addTranslation: jest.fn((t: { x: number; y: number }) => {
      state.offset = { x: state.offset.x - t.x, y: state.offset.y - t.y };
    }),
    draw: jest.fn(),
  };
  /** dwv's refit: a new fit, the zoom kept relative to it, a shifted offset. */
  const refitTo = (newFit: number, shift: { x: number; y: number }) => {
    state.fit = newFit;
    state.offset = { x: state.offset.x + shift.x, y: state.offset.y + shift.y };
  };
  const app = {
    getActiveLayerGroup: () => group,
    fitToContainer: jest.fn(),
    resetZoomPan: jest.fn(),
  };
  return { state, scale, layer, group, app, refitTo };
};

/** A 512 x 512 image (1 mm pixels) in a width-limited viewport. */
const IMAGE = 512;

describe('refitKeepingView', () => {
  it('keeps "Actual pixels" (1:1) and the centre when the viewport gets wider', () => {
    // 800 x 1000 canvas pixels: fit 800/512; zoomed to 1 canvas pixel per
    // image pixel, panned off-centre.
    const view = createView(800 / IMAGE, IMAGE / 800, { x: 40, y: -20 });
    expect(view.scale()).toBeCloseTo(1);
    const centre = view.layer.displayToPlanePos(pt(400, 500));
    view.app.fitToContainer.mockImplementation(() =>
      view.refitTo(1000 / IMAGE, { x: -15, y: 3 })
    );

    refitKeepingView(view.app as unknown as App, { width: 800, height: 1000 }, {
      width: 1000,
      height: 1000,
    });

    expect(view.app.fitToContainer).toHaveBeenCalledTimes(1);
    expect(view.scale()).toBeCloseTo(1); // still 1:1
    const shown = view.layer.displayToPlanePos(pt(500, 500));
    expect(shown.getX()).toBeCloseTo(centre.getX());
    expect(shown.getY()).toBeCloseTo(centre.getY());
    expect(view.group.draw).toHaveBeenCalled();
    expect(view.app.resetZoomPan).not.toHaveBeenCalled();
  });

  it('keeps a zoom and the centre when the viewport gets narrower again', () => {
    const view = createView(1000 / IMAGE, 2.5, { x: 100, y: 120 });
    const magnification = view.scale();
    const centre = view.layer.displayToPlanePos(pt(500, 500));
    view.app.fitToContainer.mockImplementation(() =>
      view.refitTo(800 / IMAGE, { x: 12, y: 0 })
    );

    refitKeepingView(view.app as unknown as App, { width: 1000, height: 1000 }, {
      width: 800,
      height: 1000,
    });

    expect(view.scale()).toBeCloseTo(magnification);
    expect(view.state.zoom).toBeCloseTo(2.5 * (1000 / 800));
    const shown = view.layer.displayToPlanePos(pt(400, 500));
    expect(shown.getX()).toBeCloseTo(centre.getX());
    expect(shown.getY()).toBeCloseTo(centre.getY());
  });

  it('only re-centres when the fit is unchanged (height-limited viewport)', () => {
    const view = createView(1, 3, { x: 0, y: 0 });
    const centre = view.layer.displayToPlanePos(pt(600, 300));
    view.app.fitToContainer.mockImplementation(() => view.refitTo(1, { x: 80, y: 0 }));

    refitKeepingView(view.app as unknown as App, { width: 1200, height: 600 }, {
      width: 1360,
      height: 600,
    });

    expect(view.group.setScale).not.toHaveBeenCalled();
    expect(view.state.zoom).toBe(3);
    const shown = view.layer.displayToPlanePos(pt(680, 300));
    expect(shown.getX()).toBeCloseTo(centre.getX());
    expect(shown.getY()).toBeCloseTo(centre.getY());
  });

  it('only refits when nothing is shown (no view layer)', () => {
    const app = { getActiveLayerGroup: () => undefined, fitToContainer: jest.fn() };
    refitKeepingView(app as unknown as App, { width: 1, height: 1 }, { width: 2, height: 2 });
    expect(app.fitToContainer).toHaveBeenCalledTimes(1);
  });
});
