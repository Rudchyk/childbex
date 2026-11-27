/**
 * The ruler is a thin line without dwv's perpendicular end ticks (Issue
 * #68). The ruler groups below are built with Konva (the version dwv 0.35.1
 * imports) the way dwv's RulerFactory builds them (src/tools/ruler.js): the
 * line ('shape') with a wider hit area, the two ticks ('shape-tick0',
 * 'shape-tick1'), the label and its connector; editing adds two anchors.
 * dwv updates the ticks on every anchor move and stops (before moving the
 * anchors and the hit area) when it cannot find them: they must stay.
 *
 * A Konva group stands in for the draw layer's Konva layer (a layer needs a
 * canvas): Konva.Layer fires `beforeDraw` before it paints its children.
 */
import Konva from 'konva/lib/index.js';
import { hideRulerEndTicks, keepRulerEndTicksHidden } from './DicomViewer.rulerTicks';

type Pt = { x: number; y: number };
type KonvaNode = InstanceType<typeof Konva.Node>;
type Group = InstanceType<typeof Konva.Group>;
type Line = InstanceType<typeof Konva.Line>;

const TICK_LENGTH = 20;

/** dwv's `getPerpendicularLine` (half of `length` on each side of `at`). */
const perpendicular = (begin: Pt, end: Pt, at: Pt, zoomScale = 1) => {
  const dx = end.x - begin.x;
  const dy = end.y - begin.y;
  const norm = Math.hypot(dx, dy) || 1;
  const half = (TICK_LENGTH / 2) * zoomScale;
  const nx = (-dy / norm) * half;
  const ny = (dx / norm) * half;
  return [at.x - nx, at.y - ny, at.x + nx, at.y + ny];
};

/** dwv 0.35.1 `RulerFactory#createShapeGroup` (with the editor's anchors). */
const createRulerGroup = (begin: Pt, end: Pt, { anchors = false, zoomScale = 1 } = {}) => {
  const group = new Konva.Group({ name: 'ruler-group', id: `ruler-${begin.x}-${end.x}` });
  const shape = new Konva.Line({
    name: 'shape',
    points: [begin.x, begin.y, end.x, end.y],
    stroke: '#ffff80',
    strokeWidth: 2,
    strokeScaleEnabled: false,
  });
  const tick0 = perpendicular(begin, end, begin, zoomScale);
  const tick1 = perpendicular(begin, end, end, zoomScale);
  shape.hitFunc((context) => {
    context.beginPath();
    context.moveTo(tick0[0], tick0[1]);
    context.lineTo(tick0[2], tick0[3]);
    context.lineTo(tick1[2], tick1[3]);
    context.lineTo(tick1[0], tick1[1]);
    context.closePath();
    context.fillStrokeShape(shape);
  });
  group.add(shape);
  group.add(new Konva.Line({ name: 'shape-tick0', points: tick0, stroke: '#ffff80' }));
  group.add(new Konva.Line({ name: 'shape-tick1', points: tick1, stroke: '#ffff80' }));
  const label = new Konva.Label({ name: 'label', x: end.x, y: end.y });
  label.add(new Konva.Tag({ name: 'tag' }));
  group.add(label);
  group.add(new Konva.Line({ name: 'connector', points: [0, 0, 1, 1], dash: [10, 10] }));
  if (anchors) {
    group.add(new Konva.Circle({ id: 'anchor0', name: 'anchor', x: begin.x, y: begin.y, radius: 5 }));
    group.add(new Konva.Circle({ id: 'anchor1', name: 'anchor', x: end.x, y: end.y, radius: 5 }));
  }
  return group;
};

/** dwv 0.35.1 `RulerFactory#updateShape`: false where dwv returns early. */
const updateRuler = (group: Group, begin: Pt, end: Pt) => {
  const shape = group.findOne<Line>('.shape');
  if (!shape) return false;
  shape.position({ x: 0, y: 0 });
  shape.points([begin.x, begin.y, end.x, end.y]);
  const tick0 = group.getChildren((node) => node.name() === 'shape-tick0')[0];
  if (!(tick0 instanceof Konva.Line)) return false;
  const tick1 = group.getChildren((node) => node.name() === 'shape-tick1')[0];
  if (!(tick1 instanceof Konva.Line)) return false;
  tick0.position({ x: 0, y: 0 });
  tick0.points(perpendicular(begin, end, begin));
  tick1.position({ x: 0, y: 0 });
  tick1.points(perpendicular(begin, end, end));
  return true;
};

/** dwv 0.35.1 `RectangleFactory#createShapeGroup` (the Area tool). */
const createRectangleGroup = () => {
  const group = new Konva.Group({ name: 'rectangle-group' });
  group.add(new Konva.Rect({ name: 'shape', x: 10, y: 10, width: 30, height: 20 }));
  const label = new Konva.Label({ name: 'label' });
  label.add(new Konva.Tag({ name: 'tag' }));
  group.add(label);
  group.add(new Konva.Line({ name: 'connector', points: [0, 0, 1, 1] }));
  return group;
};

/** A draw layer's Konva layer: position groups holding the shape groups. */
const createLayer = () => {
  const layer = new Konva.Group();
  const position = new Konva.Group({ name: 'position-group', id: '#2-0' });
  layer.add(position);
  return { layer, position };
};

/** What the layer paints next (dwv draws the layer after each change). */
const draw = (layer: Group) => layer.fire('beforeDraw', { node: layer });

const ticksOf = (group: Group) => group.find<Line>('.shape-tick0, .shape-tick1');

/** Everything that places a node on the image (the measured geometry). */
const geometry = (node: KonvaNode) =>
  [node, ...(node instanceof Konva.Container ? node.find(() => true) : [])].map((n) => ({
    name: n.name(),
    id: n.id(),
    position: n.position(),
    scale: n.scale(),
    rotation: n.rotation(),
    points: n instanceof Konva.Line ? [...n.points()] : undefined,
  }));

describe('ruler end ticks (Issue #68)', () => {
  it('hides both ticks of a ruler while it is drawn and once it is created', () => {
    const { layer, position } = createLayer();
    keepRulerEndTicksHidden(layer);

    // dwv's temporary shape while drawing, then the final one.
    const drawing = createRulerGroup({ x: 10, y: 10 }, { x: 14, y: 12 });
    position.add(drawing);
    draw(layer);
    expect(ticksOf(drawing).map((tick) => tick.visible())).toEqual([false, false]);

    drawing.destroy();
    const created = createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 });
    position.add(created);
    draw(layer);
    expect(ticksOf(created).map((tick) => tick.visible())).toEqual([false, false]);
  });

  it('keeps the tick nodes, so dwv still updates the ruler on anchor moves', () => {
    const { layer, position } = createLayer();
    keepRulerEndTicksHidden(layer);
    const ruler = createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 }, { anchors: true });
    position.add(ruler);
    draw(layer);

    // Both endpoints, one after the other (dwv's editor moves one anchor).
    expect(updateRuler(ruler, { x: 12, y: 11 }, { x: 40, y: 30 })).toBe(true);
    draw(layer);
    expect(updateRuler(ruler, { x: 12, y: 11 }, { x: 52, y: 33 })).toBe(true);
    draw(layer);

    expect(ruler.findOne<Line>('.shape')?.points()).toEqual([12, 11, 52, 33]);
    expect(ticksOf(ruler)).toHaveLength(2);
    expect(ticksOf(ruler).map((tick) => tick.visible())).toEqual([false, false]);
    expect(ticksOf(ruler)[1].points()).toEqual(
      perpendicular({ x: 12, y: 11 }, { x: 52, y: 33 }, { x: 52, y: 33 })
    );
  });

  it('keeps the line, label, connector and both editing anchors visible', () => {
    const { layer, position } = createLayer();
    keepRulerEndTicksHidden(layer);
    const ruler = createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 }, { anchors: true });
    position.add(ruler);
    draw(layer);

    for (const selector of ['.shape', '.label', '.connector', '#anchor0', '#anchor1']) {
      expect(ruler.findOne(selector)?.isVisible()).toBe(true);
    }
    // dwv's wider hit area of the line (selection, drag, delete) is kept.
    expect(ruler.findOne<Line>('.shape')?.hitFunc()).toEqual(expect.any(Function));
  });

  it('hides the ticks of rulers drawn again (slice change, resize, undo)', () => {
    const { layer, position } = createLayer();
    keepRulerEndTicksHidden(layer);
    position.add(createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 }));
    draw(layer);

    // dwv destroys and recreates the shapes of a position, or adds another
    // position group (another slice), then draws the layer again.
    position.destroyChildren();
    const redrawn = createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 }, { zoomScale: 0.5 });
    position.add(redrawn);
    const otherSlice = new Konva.Group({ name: 'position-group', id: '#2-1' });
    const onOtherSlice = createRulerGroup({ x: 5, y: 5 }, { x: 9, y: 6 });
    otherSlice.add(onOtherSlice);
    layer.add(otherSlice);
    draw(layer);
    draw(layer);

    expect(ticksOf(redrawn).map((tick) => tick.visible())).toEqual([false, false]);
    expect(ticksOf(onOtherSlice).map((tick) => tick.visible())).toEqual([false, false]);
  });

  it('changes no geometry at any zoom, pan or pixel ratio (anisotropic spacing too)', () => {
    // dwv's draw layer scale is spacing * zoom (* the high-DPI ratio), its
    // offset the pan: the ruler's points are in image (plane) coordinates.
    for (const view of [
      { scale: { x: 1, y: 1 }, offset: { x: 0, y: 0 } },
      { scale: { x: 0.5, y: 2.5 }, offset: { x: 0, y: 0 } },
      { scale: { x: 4 * 0.5, y: 4 * 2.5 }, offset: { x: -37, y: 12.5 } },
      { scale: { x: 2 * 0.7, y: 2 * 0.7 }, offset: { x: 3, y: -8 } },
    ]) {
      const { layer, position } = createLayer();
      layer.scale(view.scale);
      layer.offset(view.offset);
      // 1 to 5 mm at 0.5 mm × 2.5 mm pixels.
      position.add(createRulerGroup({ x: 10, y: 10 }, { x: 12, y: 10 }));
      position.add(createRulerGroup({ x: 10, y: 10 }, { x: 10, y: 12 }, { anchors: true }));
      position.add(createRectangleGroup());
      const before = geometry(layer);

      keepRulerEndTicksHidden(layer);
      draw(layer);

      expect(geometry(layer)).toEqual(before);
    }
  });

  it('leaves the Area (rectangle) and any non-ruler tick-like node alone', () => {
    const { layer, position } = createLayer();
    const rectangle = createRectangleGroup();
    position.add(rectangle);
    const other = new Konva.Group({ name: 'protractor-group' });
    other.add(new Konva.Line({ name: 'shape-tick0', points: [0, 0, 1, 1] }));
    position.add(other);
    keepRulerEndTicksHidden(layer);
    draw(layer);

    expect(rectangle.find(() => true).every((node) => node.visible())).toBe(true);
    expect(other.findOne('.shape-tick0')?.visible()).toBe(true);
  });

  it('listens once per layer, however often it is attached', () => {
    const { layer, position } = createLayer();
    keepRulerEndTicksHidden(layer);
    keepRulerEndTicksHidden(layer);
    expect(layer.eventListeners['beforeDraw']).toHaveLength(1);

    const ruler = createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 });
    position.add(ruler);
    draw(layer);
    expect(ticksOf(ruler).map((tick) => tick.visible())).toEqual([false, false]);
  });

  it('hides the ticks already on the layer when attached', () => {
    const { layer, position } = createLayer();
    const ruler = createRulerGroup({ x: 10, y: 10 }, { x: 40, y: 30 });
    position.add(ruler);

    expect(hideRulerEndTicks(layer)).toBe(2);
    expect(hideRulerEndTicks(layer)).toBe(0);
    expect(ticksOf(ruler).map((tick) => tick.visible())).toEqual([false, false]);
  });
});
