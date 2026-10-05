import {
  describeCalibration,
  getLengthCalibration,
  measurementLabelTexts,
} from './DicomViewer.calibration';

/** dwv metadata as `App#getMetaData` returns it (tag -> data element). */
const meta = (elements: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(elements).map(([tag, value]) => [tag, { value }]));

describe('getLengthCalibration', () => {
  it('uses Pixel Spacing (row, column) as the physical calibration', () => {
    expect(getLengthCalibration(meta({ '00280030': ['0.68', '0.70'] }))).toEqual({
      kind: 'pixelSpacing',
      rowSpacingMm: 0.68,
      columnSpacingMm: 0.7,
    });
  });

  it('reads backslash-separated and per-slice values', () => {
    expect(getLengthCalibration(meta({ '00280030': ['0.5\\0.5'] }))).toMatchObject({
      kind: 'pixelSpacing',
      rowSpacingMm: 0.5,
    });
    expect(
      getLengthCalibration(meta({ '00280030': { 1: ['0.4', '0.4'], 2: ['0.4', '0.4'] } }))
    ).toMatchObject({ kind: 'pixelSpacing', columnSpacingMm: 0.4 });
  });

  it('prefers Pixel Spacing over Imager Pixel Spacing', () => {
    expect(
      getLengthCalibration(meta({ '00280030': ['0.7', '0.7'], '00181164': ['0.2', '0.2'] }))
    ).toMatchObject({ kind: 'pixelSpacing', rowSpacingMm: 0.7 });
  });

  it('Imager Pixel Spacing alone is at the detector, not in the patient', () => {
    expect(getLengthCalibration(meta({ '00181164': ['0.2', '0.2'] }))).toMatchObject({
      kind: 'imagerPixelSpacing',
    });
  });

  it.each([
    [{ '00280030': ['0', '0.7'] }, 'none'],
    [{ '00280030': ['-1', '0.7'] }, 'none'],
    [{ '00280030': ['abc', '0.7'] }, 'none'],
    [{ '00280030': ['0.7'] }, 'none'],
    [{ '00182010': ['0.1', '0.1'] }, 'nominalScanned'],
    [{ '00280034': ['1', '1'] }, 'aspectRatioOnly'],
    [{}, 'none'],
  ])('never invents millimetres from invalid or missing spacing (%j)', (elements, reason) => {
    expect(getLengthCalibration(meta(elements))).toEqual({ kind: 'uncalibrated', reason });
  });
});

describe('measurement labels', () => {
  it('labels plainly only for Pixel Spacing; qualifies everything else', () => {
    expect(
      measurementLabelTexts({ kind: 'pixelSpacing', rowSpacingMm: 1, columnSpacingMm: 1 })
    ).toEqual({ ruler: { '*': '{length}' }, rectangle: { '*': '{surface}' } });
    expect(
      measurementLabelTexts({ kind: 'imagerPixelSpacing', rowSpacingMm: 1, columnSpacingMm: 1 }).ruler['*']
    ).toBe('{length} (at detector)');
    expect(measurementLabelTexts({ kind: 'uncalibrated', reason: 'aspectRatioOnly' }).ruler['*']).toBe(
      '{length} (NOT calibrated)'
    );
    // Without any spacing dwv itself reports "pixels".
    expect(measurementLabelTexts({ kind: 'uncalibrated', reason: 'none' }).ruler['*']).toBe('{length}');
  });

  it('describes the calibration for the toolbar', () => {
    expect(
      describeCalibration({ kind: 'pixelSpacing', rowSpacingMm: 0.68359375, columnSpacingMm: 0.68359375 })
    ).toMatchObject({ calibrated: true, label: 'mm · 0.6836 × 0.6836 mm/px' });
    expect(describeCalibration({ kind: 'uncalibrated', reason: 'none' })).toMatchObject({
      calibrated: false,
      label: 'Not calibrated',
    });
  });
});
