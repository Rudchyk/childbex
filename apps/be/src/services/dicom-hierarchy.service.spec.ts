/** Pure parts of the DICOM hierarchy (the SQL is covered by the PostgreSQL tests). */
import { agreeOn, seriesFieldNames } from './dicom-hierarchy.service';
import { normalizeDicomDate, normalizeDicomTime } from './dicom.metadata';

jest.mock('./logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('agreeOn', () => {
  it('takes the value all images agree on, ignoring missing ones', () => {
    const { values, disagreements } = agreeOn(
      [
        { modality: 'CT', imageType: ['ORIGINAL', 'PRIMARY'], sliceThickness: 1 },
        { modality: 'CT', imageType: ['ORIGINAL', 'PRIMARY'], sliceThickness: null },
        { modality: null, imageType: ['ORIGINAL', 'PRIMARY'] },
      ],
      ['modality', 'imageType', 'sliceThickness', 'seriesNumber'] as const
    );

    expect(values).toEqual({
      modality: 'CT',
      imageType: ['ORIGINAL', 'PRIMARY'],
      sliceThickness: 1,
      seriesNumber: null,
    });
    expect(disagreements).toEqual([]);
  });

  it('leaves a field null and reports it when images disagree', () => {
    const { values, disagreements } = agreeOn(
      [
        { sliceThickness: 1.25, imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'] },
        { sliceThickness: 5, imageType: ['ORIGINAL', 'PRIMARY', 'LOCALIZER'] },
      ],
      seriesFieldNames
    );

    expect(values.sliceThickness).toBeNull();
    expect(values.imageType).toBeNull();
    expect(disagreements).toEqual(['imageType', 'sliceThickness']);
  });
});

describe('DICOM date and time', () => {
  it.each([
    ['20200131', '2020-01-31'],
    ['20240229', '2024-02-29'],
    ['20230229', null],
    ['20201301', null],
    ['2020-01-31', null],
    ['2020.01.31', null],
    [null, null],
  ])('StudyDate %s -> %s', (value, expected) => {
    expect(normalizeDicomDate(value)).toBe(expected);
  });

  it.each([
    ['093015', '093015'],
    ['093015.123456', '093015.123456'],
    ['0930', '0930'],
    ['09', '09'],
    ['235960', '235960'],
    ['240000', null],
    ['09:30:15', null],
    ['093015.1234567', null],
    [null, null],
  ])('StudyTime %s -> %s (kept as recorded)', (value, expected) => {
    expect(normalizeDicomTime(value)).toBe(expected);
  });
});

describe('parseStudySeriesArgs', () => {
  const { parseStudySeriesArgs } = require('../db/backfill/study-series.cli');
  const { BackfillPreconditionError } = require('../db/backfill/dicom-metadata.backfill');

  it('is a dry-run by default', () => {
    expect(parseStudySeriesArgs([])).toEqual({
      apply: false,
      includeTrashed: false,
      report: null,
    });
  });

  it('reads all options', () => {
    expect(
      parseStudySeriesArgs(['--apply', '--report', 'r.json', '--include-trashed'])
    ).toEqual({ apply: true, includeTrashed: true, report: 'r.json' });
  });

  it.each([[['--apply', '--dry-run']], [['--rescan']], [['--report']]])(
    'rejects %j',
    (args) => {
      expect(() => parseStudySeriesArgs(args)).toThrow(BackfillPreconditionError);
    }
  );
});
