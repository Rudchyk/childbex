/**
 * dwv 0.35's own load error messages (synthetic values only): what the
 * viewer shows of them never contains the compared DICOM values.
 */
import { presentLoadError } from './DicomViewer.loadErrors';

const PATIENT_VALUES = ['SYNTHETIC^ALICE', 'SYNTHETIC^BOB', 'SYN-0001', '19700101'];
const shown = (error: ReturnType<typeof presentLoadError>) => JSON.stringify(error);

describe('presentLoadError', () => {
  it.each([
    ['PatientName', 'SYNTHETIC^ALICE != SYNTHETIC^BOB'],
    ['PatientID', 'SYN-0001 != SYN-0002'],
    ['PatientBirthDate', '19700101 != 19700102'],
    ['ReferringPhysicianName', 'SYNTHETIC^BOB != undefined'],
  ])('hides the compared %s values of a rejected slice', (key, values) => {
    const error = presentLoadError({
      type: 'error',
      dataid: '1',
      source: new File([], 'IM2'),
      error: new Error(`Cannot append a slice with different ${key}: ${values}`),
    });
    expect(error).toMatchObject({
      category: 'slice-mismatch',
      detail: `Different ${key} (values not shown).`,
      source: 'IM2',
    });
    for (const value of PATIENT_VALUES) expect(shown(error)).not.toContain(value);
  });

  it('keeps size and orientation differences (they carry no values)', () => {
    const error = presentLoadError({
      type: 'error',
      error: new Error('Cannot append a slice with different number of rows'),
    });
    expect(error.detail).toBe('Different number of rows.');
  });

  it.each([
    'Cannot merge object with same ids: 1, id2: 1',
    'The first object already contains id2: 2, id1: 1,2',
    'Id key not found in first object while merging: 00200013, obj: [object Object]',
  ])('reports a metadata merge error as such (%s)', (message) => {
    const error = presentLoadError({ type: 'error', error: new Error(message) });
    expect(error.category).toBe('metadata');
    expect(error.label).toBe('Image shown, DICOM details incomplete');
    expect(shown(error)).not.toMatch(/id2|00200013/);
  });

  it('reports a failed request by its status only (no URL)', () => {
    const error = presentLoadError({
      type: 'error',
      source: '/api/v1/patients/p1/images/i1/file',
      error: 'GET https://host/api/v1/patients/p1/images/i1/file?token=x 404 (Not Found)',
    });
    expect(error).toMatchObject({ category: 'request', detail: 'HTTP 404.' });
    expect(error.detail).not.toContain('token');
  });

  it('keeps only the text before any value of other messages', () => {
    const error = presentLoadError({
      type: 'error',
      error: new Error('No loader found for file: SYNTHETIC^ALICE.dcm'),
    });
    expect(error).toMatchObject({ category: 'other', detail: 'No loader found for file' });
  });

  it('describes aborts and reader errors without a message', () => {
    expect(presentLoadError({ type: 'abort' }).category).toBe('aborted');
    expect(presentLoadError({ type: 'error', error: { type: 'error' } }).category).toBe('read');
  });
});
