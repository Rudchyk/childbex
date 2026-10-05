/**
 * Physical calibration of in-plane lengths (ruler / area), from the DICOM
 * header of the displayed image (pure).
 *
 * dwv measures in image-pixel space and multiplies by the first spacing it
 * finds among PixelSpacing, ImagerPixelSpacing, NominalScannedPixelSpacing
 * and PixelAspectRatio, labelling the result "mm" for any of them. Only
 * PixelSpacing (0028,0030) is a physical spacing in the patient; Imager
 * Pixel Spacing is at the detector (not corrected for magnification);
 * the others are not a calibration of the patient. The viewer therefore
 * labels anything but PixelSpacing explicitly and never derives a length
 * from browser pixels (dwv's measurement does not depend on zoom, pan or
 * the display's pixel ratio).
 */

export type LengthCalibration =
  | { kind: 'pixelSpacing'; rowSpacingMm: number; columnSpacingMm: number }
  | { kind: 'imagerPixelSpacing'; rowSpacingMm: number; columnSpacingMm: number }
  | { kind: 'uncalibrated'; reason: 'none' | 'nominalScanned' | 'aspectRatioOnly' };

/** The tags as dwv's metadata keys them (group + element, upper case). */
const TAGS = {
  pixelSpacing: '00280030',
  imagerPixelSpacing: '00181164',
  nominalScannedPixelSpacing: '00182010',
  pixelAspectRatio: '00280034',
} as const;

type MetaData = Record<string, unknown>;

/** dwv keys values that differ between slices by slice number ("1", ...). */
const firstSlice = (value: unknown): unknown =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.values(value as Record<string, unknown>)[0]
    : value;

/** The numeric values of a tag (dwv data element or plain array), or null. */
const numbers = (meta: MetaData, tag: string): number[] | null => {
  const element = meta[tag] as { value?: unknown } | unknown[] | undefined;
  const raw = Array.isArray(element)
    ? element
    : element && typeof element === 'object' && 'value' in element
      ? firstSlice(element.value)
      : undefined;
  if (!Array.isArray(raw)) return null;
  const values = raw.flatMap((value) => String(value).split('\\')).map(Number);
  return values.length ? values : null;
};

/** A valid in-plane spacing: two finite, positive values (row, column). */
const spacing = (values: number[] | null) =>
  values &&
  values.length === 2 &&
  values.every((value) => Number.isFinite(value) && value > 0)
    ? { rowSpacingMm: values[0], columnSpacingMm: values[1] }
    : null;

export const getLengthCalibration = (meta: MetaData): LengthCalibration => {
  const pixel = spacing(numbers(meta, TAGS.pixelSpacing));
  if (pixel) return { kind: 'pixelSpacing', ...pixel };
  const imager = spacing(numbers(meta, TAGS.imagerPixelSpacing));
  if (imager) return { kind: 'imagerPixelSpacing', ...imager };
  if (spacing(numbers(meta, TAGS.nominalScannedPixelSpacing))) {
    return { kind: 'uncalibrated', reason: 'nominalScanned' };
  }
  if (numbers(meta, TAGS.pixelAspectRatio)) {
    return { kind: 'uncalibrated', reason: 'aspectRatioOnly' };
  }
  return { kind: 'uncalibrated', reason: 'none' };
};

/**
 * dwv shape label templates (`custom.labelTexts`) for a calibration: plain
 * for PixelSpacing, explicitly qualified otherwise (dwv would print "mm").
 */
export const measurementLabelTexts = (
  calibration: LengthCalibration
): Record<'ruler' | 'rectangle', Record<string, string>> => {
  const suffix =
    calibration.kind === 'pixelSpacing'
      ? ''
      : calibration.kind === 'imagerPixelSpacing'
        ? ' (at detector)'
        : calibration.reason === 'none'
          ? ''
          : ' (NOT calibrated)';
  return {
    ruler: { '*': `{length}${suffix}` },
    rectangle: { '*': `{surface}${suffix}` },
  };
};

/** A short human description of the calibration (toolbar). */
export const describeCalibration = (calibration: LengthCalibration) => {
  const mm = (value: number) => Number(value.toPrecision(4));
  switch (calibration.kind) {
    case 'pixelSpacing':
      return {
        label: `mm · ${mm(calibration.rowSpacingMm)} × ${mm(calibration.columnSpacingMm)} mm/px`,
        detail:
          'Lengths and areas use the DICOM Pixel Spacing (0028,0030): physical size in the patient. Zoom and pan do not change them.',
        calibrated: true,
      };
    case 'imagerPixelSpacing':
      return {
        label: 'mm at detector',
        detail:
          'Only Imager Pixel Spacing (0018,1164) is present: lengths are at the detector plane and are not corrected for geometric magnification.',
        calibrated: false,
      };
    default:
      return {
        label: 'Not calibrated',
        detail:
          calibration.reason === 'none'
            ? 'The image has no pixel spacing: lengths are in image pixels, not millimetres.'
            : 'The image has no Pixel Spacing; the values the viewer shows are not physical millimetres.',
        calibrated: false,
      };
  }
};
