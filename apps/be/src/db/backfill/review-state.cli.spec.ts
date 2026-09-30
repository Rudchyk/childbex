/** Option parsing of `backfill review-state`. */
import { parseReviewStateBackfillArgs } from './review-state.cli';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const IMAGE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

describe('parseReviewStateBackfillArgs', () => {
  it('is a dry-run without decisions by default', () => {
    expect(parseReviewStateBackfillArgs([])).toEqual({
      apply: false,
      report: null,
      decisions: new Map(),
      operator: null,
    });
  });

  it('parses label and IGNORE decisions with the operator', () => {
    const options = parseReviewStateBackfillArgs([
      '--apply',
      '--legacy-resolution',
      `${IMAGE}=ABNORMAL`,
      '--legacy-resolution',
      `${OTHER.toUpperCase()}=IGNORE`,
      '--operator',
      'Dr. Operator',
    ]);
    expect(options.apply).toBe(true);
    expect([...options.decisions]).toEqual([
      [IMAGE, 'ABNORMAL'],
      [OTHER, 'IGNORE'],
    ]);
    expect(options.operator).toBe('Dr. Operator');
  });

  it('requires --operator for every legacy-resolution action', () => {
    expect(() =>
      parseReviewStateBackfillArgs(['--legacy-resolution', `${IMAGE}=NORMAL`])
    ).toThrow('--operator');
    expect(() =>
      parseReviewStateBackfillArgs([
        '--legacy-resolution',
        `${IMAGE}=NORMAL`,
        '--operator',
        '  ',
      ])
    ).toThrow('--operator');
  });

  it.each([
    [`${IMAGE}=normal`],
    [`${IMAGE}=CONFLICTED`],
    [`${IMAGE}`],
    [`not-a-uuid=NORMAL`],
    [`${IMAGE}=NORMAL=X`],
  ])('rejects the malformed decision %s', (value) => {
    expect(() =>
      parseReviewStateBackfillArgs([
        '--legacy-resolution',
        value,
        '--operator',
        'Op',
      ])
    ).toThrow('--legacy-resolution needs');
  });

  it('rejects two decisions for one image', () => {
    expect(() =>
      parseReviewStateBackfillArgs([
        '--legacy-resolution',
        `${IMAGE}=NORMAL`,
        '--legacy-resolution',
        `${IMAGE}=IGNORE`,
        '--operator',
        'Op',
      ])
    ).toThrow('given twice');
  });

  it('rejects unknown options and --dry-run with --apply', () => {
    expect(() => parseReviewStateBackfillArgs(['--force'])).toThrow('Unknown option');
    expect(() => parseReviewStateBackfillArgs(['--apply', '--dry-run'])).toThrow(
      'either --dry-run or --apply'
    );
  });
});
