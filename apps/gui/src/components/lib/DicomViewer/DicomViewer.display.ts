/**
 * Display geometry of the DICOM viewport (pure).
 *
 * dwv sizes its canvases in CSS pixels (`offsetWidth` of the layer
 * container) and ignores `devicePixelRatio`: on a high-DPI display the
 * browser then stretches every canvas by the pixel ratio with bilinear
 * filtering (blur), and the viewport has only 1/dpr² of the device pixels
 * it occupies. The viewer therefore gives dwv a container `dpr` times
 * larger and scales it back down with a CSS transform: dwv's canvases get
 * one canvas pixel per device pixel. Nothing is resampled beyond dwv's own
 * rendering (nearest neighbour, as before); no sharpening or synthetic
 * detail is added. Measurements are unaffected: dwv measures in image
 * pixels times the DICOM spacing.
 */

/** Ratios outside this range are treated as 1 (nothing gained / unsafe). */
const MAX_PIXEL_RATIO = 4;

/**
 * The device pixel ratio the viewport renders at: the display's ratio on
 * fine pointers, 1 when a coarse pointer (touch) may be used (dwv reads
 * touch positions from page coordinates, which a CSS transform would
 * offset).
 */
export const effectivePixelRatio = (
  devicePixelRatio: number | undefined,
  coarsePointer: boolean
) => {
  const ratio = devicePixelRatio ?? 1;
  if (coarsePointer || !Number.isFinite(ratio) || ratio <= 1) return 1;
  return Math.min(ratio, MAX_PIXEL_RATIO);
};

export interface HiDpiLayout {
  /** Size of the container dwv sees (device pixels). */
  width: number;
  height: number;
  /** CSS scale bringing it back to the CSS size. */
  scale: number;
}

/** The dwv container for a CSS size at a pixel ratio. */
export const hiDpiLayout = (
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number
): HiDpiLayout => {
  const width = Math.max(1, Math.round(cssWidth * pixelRatio));
  const height = Math.max(1, Math.round(cssHeight * pixelRatio));
  return { width, height, scale: cssWidth > 0 ? cssWidth / width : 1 };
};

export interface ImageGeometry {
  /** Columns and rows of the image. */
  columns: number;
  rows: number;
  /** dwv's spacing (column, row); 1 when the image has none. */
  columnSpacing: number;
  rowSpacing: number;
}

/**
 * Canvas pixels per image pixel (along a row) when dwv fits the image to a
 * container of `containerWidth` x `containerHeight` canvas pixels (dwv:
 * divToWorldSizeRatio = min(W / (cols * sx), H / (rows * sy)), times sx).
 */
export const fitCanvasPixelsPerImagePixel = (
  containerWidth: number,
  containerHeight: number,
  { columns, rows, columnSpacing, rowSpacing }: ImageGeometry
) =>
  Math.min(
    containerWidth / (columns * columnSpacing),
    containerHeight / (rows * rowSpacing)
  ) * columnSpacing;

/**
 * The zoom (relative to fit) at which one image pixel is one canvas pixel,
 * i.e. one device pixel with the high-DPI container ("Actual pixels" 1:1).
 * Null without a usable geometry.
 */
export const actualPixelsZoom = (
  containerWidth: number,
  containerHeight: number,
  geometry: ImageGeometry
): number | null => {
  const values = [
    containerWidth,
    containerHeight,
    geometry.columns,
    geometry.rows,
    geometry.columnSpacing,
    geometry.rowSpacing,
  ];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return null;
  return 1 / fitCanvasPixelsPerImagePixel(containerWidth, containerHeight, geometry);
};
