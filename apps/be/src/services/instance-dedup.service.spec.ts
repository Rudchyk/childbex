/** The DICOM instance deduplication decision (pure; SQL is covered by the PostgreSQL tests). */
import {
  InstanceConflictError,
  planInstances,
  type ExistingInstance,
  type IncomingInstance,
} from './instance-dedup.service';

const PATIENT = 'patient-1';
const incoming = (
  file: string,
  values: Partial<IncomingInstance> = {}
): IncomingInstance => ({
  file,
  sopInstanceUid: '2.25.1',
  fileSha256: 'hash-1',
  studyInstanceUid: '2.25.10',
  seriesInstanceUid: '2.25.20',
  seriesId: 'series-1',
  ...values,
});
const stored = (values: Partial<ExistingInstance> = {}): ExistingInstance => ({
  id: 'image-1',
  patientId: PATIENT,
  sopInstanceUid: '2.25.1',
  fileSha256: 'hash-1',
  studyInstanceUid: '2.25.10',
  seriesInstanceUid: '2.25.20',
  seriesId: 'series-1',
  ...values,
});
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InstanceConflictError);
    return (error as InstanceConflictError).code;
  }
  return 'no error';
};

describe('planInstances', () => {
  it('imports a new instance', () => {
    const plan = planInstances(PATIENT, [incoming('a')], []);

    expect([...plan.toImport]).toEqual(['a']);
    expect(plan.alreadyImported.size).toBe(0);
  });

  it('A: same SOP UID and hash in the same patient, study and series -> already imported', () => {
    const plan = planInstances(PATIENT, [incoming('a')], [stored()]);

    expect([...plan.alreadyImported]).toEqual(['a']);
    expect(plan.toImport.size).toBe(0);
  });

  it('A: also when the stored row is not linked to a series yet', () => {
    const plan = planInstances(PATIENT, [incoming('a')], [stored({ seriesId: null })]);

    expect([...plan.alreadyImported]).toEqual(['a']);
  });

  it('A: also with several identical legacy rows', () => {
    const plan = planInstances(
      PATIENT,
      [incoming('a')],
      [stored({ id: 'image-1' }), stored({ id: 'image-2' })]
    );

    expect([...plan.alreadyImported]).toEqual(['a']);
  });

  it.each([
    ['B: another hash', { fileSha256: 'hash-2' }],
    ['B\': no stored hash (unverified)', { fileSha256: null }],
  ])('%s -> content conflict', (_, values) => {
    expect(
      codeOf(() => planInstances(PATIENT, [incoming('a')], [stored(values)]))
    ).toBe('SOP_INSTANCE_CONTENT_CONFLICT');
  });

  it('rejects when one of several legacy rows has other content', () => {
    expect(
      codeOf(() =>
        planInstances(
          PATIENT,
          [incoming('a')],
          [stored({ id: 'image-1' }), stored({ id: 'image-2', fileSha256: 'hash-2' })]
        )
      )
    ).toBe('SOP_INSTANCE_CONTENT_CONFLICT');
  });

  it('rejects an instance stored for another patient (also when trashed)', () => {
    expect(
      codeOf(() =>
        planInstances(PATIENT, [incoming('a')], [stored({ patientId: 'patient-2' })])
      )
    ).toBe('SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT');
  });

  it.each([
    ['another study', { studyInstanceUid: '2.25.11' }],
    ['another series UID', { seriesInstanceUid: '2.25.21' }],
    ['another linked series', { seriesId: 'series-2' }],
  ])('rejects an instance stored in %s', (_, values) => {
    expect(
      codeOf(() => planInstances(PATIENT, [incoming('a')], [stored(values)]))
    ).toBe('SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES');
  });

  it('keeps one of two identical files in the archive, rejects different ones', () => {
    const plan = planInstances(PATIENT, [incoming('a'), incoming('b')], []);
    expect([...plan.toImport]).toEqual(['a']);
    expect([...plan.alreadyImported]).toEqual(['b']);

    expect(
      codeOf(() =>
        planInstances(
          PATIENT,
          [incoming('a'), incoming('b', { fileSha256: 'hash-2' })],
          []
        )
      )
    ).toBe('SOP_INSTANCE_CONTENT_CONFLICT');
  });

  it('imports different instances with the same file name', () => {
    // File names are not identity: the files differ only by SOP UID.
    const plan = planInstances(
      PATIENT,
      [
        incoming('/work/1/IM0'),
        incoming('/work/2/IM0', { sopInstanceUid: '2.25.2', fileSha256: 'hash-2' }),
      ],
      []
    );

    expect(plan.toImport.size).toBe(2);
  });

  it('C: same hash under another SOP UID -> imported, stored image reported', () => {
    const plan = planInstances(
      PATIENT,
      [incoming('a')],
      [stored({ id: 'legacy', sopInstanceUid: '2.25.999' })]
    );

    expect([...plan.toImport]).toEqual(['a']);
    expect(plan.possibleDuplicateContent).toEqual(['legacy']);
  });

  it('D: an image without SOP UID is imported as before', () => {
    const plan = planInstances(PATIENT, [incoming('a', { sopInstanceUid: null })], []);

    expect([...plan.toImport]).toEqual(['a']);
  });

  it('keeps UIDs and hashes out of the error messages', () => {
    try {
      planInstances(PATIENT, [incoming('/work/Doe_John.dcm')], [stored({ fileSha256: 'x' })]);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/2\.25|hash|Doe_John|\/work/);
    }
  });
});
