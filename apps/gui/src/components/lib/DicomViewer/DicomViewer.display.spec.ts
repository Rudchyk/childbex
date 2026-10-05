import {
  actualPixelsZoom,
  effectivePixelRatio,
  fitCanvasPixelsPerImagePixel,
  hiDpiLayout,
} from './DicomViewer.display';

const ct = { columns: 512, rows: 512, columnSpacing: 0.7, rowSpacing: 0.7 };

describe('effectivePixelRatio', () => {
  it.each([
    [2, false, 2],
    [1.5, false, 1.5],
    [1, false, 1],
    [0.8, false, 1],
    [undefined, false, 1],
    [Number.NaN, false, 1],
    [8, false, 4],
    // Touch input: dwv reads touch positions from page coordinates.
    [2, true, 1],
  ])('dpr %s (coarse pointer %s) -> %s', (dpr, coarse, expected) => {
    expect(effectivePixelRatio(dpr, coarse)).toBe(expected);
  });
});

describe('hiDpiLayout', () => {
  it('gives dwv the device-pixel size and scales it back to the CSS size', () => {
    expect(hiDpiLayout(900, 600, 2)).toEqual({ width: 1800, height: 1200, scale: 0.5 });
    const fractional = hiDpiLayout(901, 601, 1.25);
    expect(fractional).toMatchObject({ width: 1126, height: 751 });
    // The scaled container covers exactly the CSS width.
    expect(fractional.width * fractional.scale).toBeCloseTo(901, 6);
    expect(hiDpiLayout(800, 600, 1)).toEqual({ width: 800, height: 600, scale: 1 });
  });
});

describe('fit and actual pixels', () => {
  it("matches dwv's fit: the smaller of the two axis ratios", () => {
    // A 500 px tall viewport shows a 512-row CT minified (0.977 px per pixel).
    expect(fitCanvasPixelsPerImagePixel(1000, 500, ct)).toBeCloseTo(500 / 512, 9);
    expect(fitCanvasPixelsPerImagePixel(400, 1000, ct)).toBeCloseTo(400 / 512, 9);
  });

  it('1:1 is the zoom at which one image pixel is one canvas (device) pixel', () => {
    const zoom = actualPixelsZoom(1000, 500, ct) as number;
    expect(zoom * fitCanvasPixelsPerImagePixel(1000, 500, ct)).toBeCloseTo(1, 9);
    // Already 1:1 when the viewport fits the image exactly.
    expect(actualPixelsZoom(512, 512, ct)).toBeCloseTo(1, 9);
  });

  it('accounts for anisotropic spacing like dwv (world-size fit)', () => {
    const geometry = { columns: 256, rows: 256, columnSpacing: 1, rowSpacing: 2 };
    // World size 256 x 512 mm in 512 x 512 px: height limits (1 px/mm).
    expect(fitCanvasPixelsPerImagePixel(512, 512, geometry)).toBeCloseTo(1, 9);
    expect(actualPixelsZoom(512, 512, geometry)).toBeCloseTo(1, 9);
  });

  it('is null without a usable geometry', () => {
    expect(actualPixelsZoom(0, 500, ct)).toBeNull();
    expect(actualPixelsZoom(500, 500, { ...ct, columnSpacing: Number.NaN })).toBeNull();
  });
});
