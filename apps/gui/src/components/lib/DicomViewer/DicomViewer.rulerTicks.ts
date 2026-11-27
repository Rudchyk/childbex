/** The Konva node API this needs (dwv 0.35 draws with Konva 9). */
interface KonvaNodeLike {
  name(): string;
  getParent(): KonvaNodeLike | null | undefined;
  visible(): boolean;
  visible(visible: boolean): unknown;
}

/** A draw layer's Konva layer (`DrawLayer#getKonvaLayer`). */
export interface KonvaLayerLike {
  find(selector: string): KonvaNodeLike[];
  on(event: string, handler: () => void): unknown;
  off(event: string): unknown;
  batchDraw?(): unknown;
}

/** dwv 0.35 RulerFactory: the ruler's group and its perpendicular end ticks. */
const RULER_GROUP = 'ruler-group';
const RULER_END_TICKS = '.shape-tick0, .shape-tick1';
/** Konva event (namespaced: one listener per layer). */
const BEFORE_DRAW = 'beforeDraw.rulerEndTicks';

/**
 * Hides the end ticks of the rulers on `layer`; the number hidden now.
 *
 * Only hidden, never removed: dwv's RulerFactory looks the ticks up on
 * every anchor move (and stops there, before it moves the anchors and the
 * line's hit area, when they are missing) and moves them along with a
 * dragged ruler. Their geometry, the line, its hit area, label and anchors
 * are untouched, and so is the measurement (the annotation's line).
 */
export const hideRulerEndTicks = (layer: KonvaLayerLike) => {
  let hidden = 0;
  for (const tick of layer.find(RULER_END_TICKS)) {
    if (tick.getParent()?.name() !== RULER_GROUP || !tick.visible()) continue;
    tick.visible(false);
    hidden += 1;
  }
  return hidden;
};

/**
 * Draws the rulers on `layer` as a thin line, without dwv's perpendicular
 * end ticks (Issue #68: they cover the edges of small structures).
 *
 * dwv creates ruler shapes in several places (while drawing, once drawn,
 * after an edit, undo or redo, and again for each slice shown) and draws
 * the layer after each; Konva fires `beforeDraw` before it paints, so the
 * ticks are hidden before they could ever be seen. Attaching again
 * replaces the listener.
 */
export const keepRulerEndTicksHidden = (layer: KonvaLayerLike) => {
  layer.off(BEFORE_DRAW);
  layer.on(BEFORE_DRAW, () => {
    hideRulerEndTicks(layer);
  });
  if (hideRulerEndTicks(layer) > 0) layer.batchDraw?.();
};
