import { App, Point2D } from 'dwv';

/** A dwv container size (canvas pixels). */
export interface ContainerSize {
  width: number;
  height: number;
}

const centreOf = ({ width, height }: ContainerSize) => new Point2D(width / 2, height / 2);

/**
 * Refits dwv to its resized container (e.g. a side panel collapsed) and
 * keeps what the user set up: the magnification on screen and the image
 * point at the centre of the view.
 *
 * dwv 0.35 keeps the zoom relative to the fit: `fitToContainer` multiplies
 * each layer's scale by new fit / old fit, so when the fit changes (a
 * width-limited viewport gets wider or narrower) the image on screen grows
 * or shrinks, e.g. "Actual pixels" (1:1) is lost. This scales the layer
 * group back by the inverse (`setScale`), then pans the point that was at
 * the old centre to the new one (`addTranslation`, as dwv's pan does). The
 * slice, window/level, drawings (the group's draw layers follow its scale
 * and offset) and the tool are not touched.
 *
 * `previous` is the container size dwv was last fitted to (the current one
 * is read by dwv itself).
 */
export const refitKeepingView = (
  app: App,
  previous: ContainerSize,
  next: ContainerSize
) => {
  const group = app.getActiveLayerGroup();
  const layer = group?.getBaseViewLayer();
  if (!group || !layer) {
    app.fitToContainer();
    return;
  }
  const unit = new Point2D(1, 1);
  // Before: what is at the centre, and plane units per canvas pixel.
  const centre = layer.displayToPlanePos(centreOf(previous));
  const before = layer.displayToPlaneScale(unit).getX();

  app.fitToContainer();

  const factor = layer.displayToPlaneScale(unit).getX() / before;
  if (Number.isFinite(factor) && factor > 0 && factor !== 1) {
    const scale = group.getScale();
    group.setScale({ x: scale.x * factor, y: scale.y * factor, z: scale.z * factor });
  }
  const shown = layer.displayToPlanePos(centreOf(next));
  const offset = layer.getViewController().getOffset3DFromPlaneOffset({
    x: shown.getX() - centre.getX(),
    y: shown.getY() - centre.getY(),
  });
  group.addTranslation({ x: offset.getX(), y: offset.getY(), z: offset.getZ() });
  group.draw();
};
