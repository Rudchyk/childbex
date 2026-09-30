/** Duplicate SOP classification and canonical choice (pure; SQL and files are covered by the PostgreSQL tests). */
import {
  chooseCanonical,
  classifyGroup,
  hasReviewData,
  type DuplicateRow,
  type FileCheck,
} from './duplicate-sop.cleanup';
import { parseDuplicateSopArgs } from './duplicate-sop.cli';
import { BackfillPreconditionError } from '../backfill/dicom-metadata.backfill';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const row = (id: string, values: Partial<DuplicateRow> = {}): DuplicateRow => ({
  id,
  patientId: 'p1',
  clusterId: 'c1',
  source: `/uploads/p1/c1/${id}`,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  seriesId: 's1',
  status: 'not_reviewed',
  notes: null,
  isBrocken: false,
  votesCount: 0,
  adminResolutionId: null,
  adminResolutionName: null,
  resolutionComment: null,
  resolvedAt: null,
  voteRows: 0,
  studyInstanceUid: '2.25.10',
  seriesInstanceUid: '2.25.20',
  sopInstanceUid: '2.25.1',
  fileSha256: 'a'.repeat(64),
  fileSize: '1000',
  modality: 'CT',
  ...values,
});
const okFiles = (rows: DuplicateRow[]) =>
  new Map<string, FileCheck>(
    rows.map(({ id }) => [
      id,
      { ok: true, realPath: `/real/${id}`, fileId: `1:${id}`, plainPath: true },
    ])
  );
const classify = (rows: DuplicateRow[], files = okFiles(rows)) =>
  classifyGroup(rows, files);

describe('classifyGroup', () => {
  it('SAFE_IDENTICAL: same instance, even in different clusters', () => {
    const rows = [row('b'), row('a', { clusterId: 'c2', fileSize: 1000 })];

    expect(classify(rows)).toEqual({
      classification: 'SAFE_IDENTICAL',
      reasons: [],
      canonicalId: 'a',
      duplicateIds: ['b'],
    });
  });

  it.each([
    ['OWNER_CONFLICT', { patientId: 'p2' }],
    ['STUDY_SERIES_CONFLICT', { studyInstanceUid: '2.25.11' }],
    ['STUDY_SERIES_CONFLICT', { seriesInstanceUid: '2.25.21' }],
    ['STUDY_SERIES_CONFLICT', { seriesId: 's2' }],
    ['UNVERIFIED', { fileSha256: null }],
    ['CONTENT_CONFLICT', { fileSha256: 'b'.repeat(64) }],
    ['METADATA_CONFLICT', { modality: 'MR' }],
  ])('%s', (classification, values) => {
    expect(classify([row('a'), row('b', values)]).classification).toBe(
      classification
    );
  });

  it('checks in a fixed order: owner, hierarchy, verification, content, metadata, files, review', () => {
    // Everything is wrong at once: the owner conflict is reported.
    const all = row('b', {
      patientId: 'p2',
      seriesInstanceUid: '2.25.21',
      fileSha256: null,
      modality: 'MR',
      voteRows: 1,
    });
    expect(classify([row('a', { voteRows: 1 }), all]).classification).toBe(
      'OWNER_CONFLICT'
    );
    expect(
      classify([row('a'), row('b', { fileSha256: null, modality: 'MR' })])
        .classification
    ).toBe('UNVERIFIED');
  });

  it('an unlinked row (seriesId NULL) in the same series is not a conflict', () => {
    expect(classify([row('a'), row('b', { seriesId: null })]).classification).toBe(
      'SAFE_IDENTICAL'
    );
  });

  it('slicePosition (depends on the cluster) is not compared', () => {
    expect(
      classify([row('a', { slicePosition: 1 }), row('b', { slicePosition: 2 })])
        .classification
    ).toBe('SAFE_IDENTICAL');
  });

  it.each(['missing', 'unsafe_path', 'hash_mismatch', 'read_failed'] as const)(
    'FILE_PROBLEM: %s',
    (problem) => {
      const rows = [row('a'), row('b')];
      const files = okFiles(rows);
      files.set('b', { ok: false, problem });

      expect(classify(rows, files)).toEqual({
        classification: 'FILE_PROBLEM',
        reasons: [problem],
      });
    }
  );

  it('REVIEW_CONFLICT: review data on two rows', () => {
    expect(
      classify([row('a', { voteRows: 1, votesCount: 1 }), row('b', { status: 'abnormal' })])
        .classification
    ).toBe('REVIEW_CONFLICT');
  });

  it('one reviewed row becomes the canonical row', () => {
    const rows = [
      row('a', { createdAt: new Date('2020-01-01T00:00:00Z') }),
      row('z', { voteRows: 2, votesCount: 2, status: 'abnormal' }),
    ];

    expect(classify(rows)).toMatchObject({
      classification: 'SAFE_IDENTICAL',
      canonicalId: 'z',
      duplicateIds: ['a'],
    });
  });
});

describe('hasReviewData', () => {
  it.each([
    ['votes', { voteRows: 1 }],
    ['vote counters', { votesCount: 1 }],
    ['a reviewed status', { status: 'normal' }],
    ['an admin resolution', { adminResolutionId: 'admin' }],
    ['a resolution date', { resolvedAt: new Date() }],
    ['a resolution comment', { resolutionComment: 'x' }],
    ['notes of a regular image', { notes: 'suspicious' }],
  ])('counts %s', (_, values) => {
    expect(hasReviewData(row('a', values))).toBe(true);
  });

  it('ignores an unreviewed row and the technical notes of a broken image', () => {
    expect(hasReviewData(row('a'))).toBe(false);
    expect(
      hasReviewData(
        row('a', { isBrocken: true, status: 'broken', notes: 'pixeldata_size(expected=128,actual=4)' })
      )
    ).toBe(false);
  });
});

describe('chooseCanonical', () => {
  it('prefers the oldest row, then the smallest id (deterministic)', () => {
    const early = new Date('2020-01-01T00:00:00Z');
    expect(chooseCanonical([row('b'), row('c', { createdAt: early }), row('a')]).id).toBe('c');
    expect(chooseCanonical([row('c'), row('a'), row('b')]).id).toBe('a');
    expect(chooseCanonical([row('b'), row('a'), row('c')]).id).toBe('a');
  });
});

describe('parseDuplicateSopArgs', () => {
  it('is a dry-run by default', () => {
    expect(parseDuplicateSopArgs([])).toEqual({ apply: false, report: null, group: null });
  });

  it('reads all options', () => {
    expect(
      parseDuplicateSopArgs(['--apply', '--report', 'r.json', '--group', 'k-0123456789abcdef'])
    ).toEqual({ apply: true, report: 'r.json', group: 'k-0123456789abcdef' });
  });

  it.each([
    [['--apply', '--dry-run']],
    [['--force']],
    [['--group', '2.25.1']],
    [['--group']],
  ])('rejects %j', (args) => {
    expect(() => parseDuplicateSopArgs(args)).toThrow(BackfillPreconditionError);
  });
});
