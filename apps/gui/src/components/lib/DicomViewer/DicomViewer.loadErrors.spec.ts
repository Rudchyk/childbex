/**
 * dwv 0.35's own load error messages and sources (synthetic values only):
 * what the viewer shows of them never contains DICOM values, file names or
 * URLs.
 */
import { presentLoadError, WITHHELD_DETAIL } from './DicomViewer.loadErrors';

const SENSITIVE = [
  'SYNTHETIC^ALICE',
  'SYNTHETIC^BOB',
  'SYN-0001',
  '19700101',
  'token',
  'secret',
  'p1',
  'Alice',
];
const expectNothingSensitive = (error: ReturnType<typeof presentLoadError>) => {
  const shown = JSON.stringify(error);
  for (const value of SENSITIVE) expect(shown).not.toContain(value);
};
const file = new File([], 'SYNTHETIC^ALICE_SYN-0001_19700101.dcm');
const inputs = [new File([], 'IM1'), file];

describe('presentLoadError', () => {
  it.each([
    ['PatientName', 'SYNTHETIC^ALICE != SYNTHETIC^BOB'],
    ['PatientID', 'SYN-0001 != SYN-0002'],
    ['PatientBirthDate', '19700101 != 19700102'],
    ['ReferringPhysicianName', 'SYNTHETIC^BOB != undefined'],
  ])('hides the compared %s values of a rejected slice', (key, values) => {
    const error = presentLoadError(
      {
        type: 'error',
        dataid: '1',
        source: file,
        error: new Error(`Cannot append a slice with different ${key}: ${values}`),
      },
      inputs
    );
    expect(error).toMatchObject({
      category: 'slice-mismatch',
      detail: `Different ${key} (values not shown).`,
      source: 'Input 2 of 2',
    });
    expectNothingSensitive(error);
  });

  it('names a file by its position in the load, never by its name', () => {
    const error = presentLoadError(
      { type: 'error', source: file, error: new Error('No pixel data in DICOM file') },
      inputs
    );
    expect(error).toMatchObject({ source: 'Input 2 of 2', detail: 'No pixel data.' });
    expectNothingSensitive(error);
  });

  it('names a URL by its position, and reports a failed request by its status only', () => {
    const urls = ['/api/v1/patients/p1/images/i1/file?token=secret'];
    const error = presentLoadError(
      {
        type: 'error',
        source: urls[0],
        error: 'GET https://user:secret@host/api/v1/patients/p1/images/i1/file?token=secret 404 (Not Found)',
      },
      urls
    );
    expect(error).toMatchObject({ category: 'request', detail: 'HTTP 404.', source: 'Input 1 of 1' });
    expectNothingSensitive(error);
  });

  it.each([
    [undefined, 'Whole load'],
    [new File([], 'SYNTHETIC^ALICE.dcm'), 'Unidentified input'],
    ['https://host/other?token=secret', 'Unidentified input'],
  ])('labels a source that is not an input of the load (%p)', (source, label) => {
    const error = presentLoadError({ type: 'error', source, error: new Error('x') }, inputs);
    expect(error.source).toBe(label);
    expectNothingSensitive(error);
  });

  it('keeps size and orientation differences (they carry no values)', () => {
    const error = presentLoadError(
      { type: 'error', error: new Error('Cannot append a slice with different number of rows') },
      inputs
    );
    expect(error.detail).toBe('Different number of rows.');
  });

  it.each([
    'Cannot merge object with same ids: 1, id2: 1',
    'The first object already contains id2: 2, id1: 1,2',
    'Id key not found in first object while merging: 00200013, obj: [object Object]',
  ])('reports a metadata merge error as such (%s)', (message) => {
    const error = presentLoadError({ type: 'error', error: new Error(message) }, inputs);
    expect(error.category).toBe('metadata');
    expect(error.label).toBe('Image shown, DICOM details incomplete');
    expect(JSON.stringify(error)).not.toMatch(/id2|00200013/);
  });

  it.each([
    ['No loader found for file: SYNTHETIC^ALICE.dcm', 'No viewer loader for this input.'],
    ['Unsupported DICOM transfer syntax: 1.2.3', 'Unsupported transfer syntax.'],
    ['Problem while parsing, bad offset', 'Damaged DICOM file (could not be parsed).'],
    ['Not a valid DICOM file (no TransferSyntaxUID found)', 'Not a valid DICOM file.'],
  ])('replaces a known dwv message by a fixed text (%s)', (message, detail) => {
    const error = presentLoadError({ type: 'error', error: new Error(message) }, inputs);
    expect(error).toMatchObject({ category: 'invalid', detail });
    expectNothingSensitive(error);
  });

  it.each([
    // No colon: the old prefix rule would have shown it whole.
    ['a colonless message', new Error('Patient SYNTHETIC^ALICE born 19700101 could not be decoded')],
    ['a message with a colon late', new Error('Decoder failed for SYNTHETIC^ALICE: bad data')],
    ['an unknown error object', { message: 'SYN-0001 token=secret' }],
    ['a plain string', 'SYNTHETIC^BOB'],
    ['an attribute name that is no name', new Error('Cannot append a slice with different SYNTHETIC^ALICE: x')],
  ])('withholds any other message: %s', (_, error) => {
    const presented = presentLoadError({ type: 'error', error }, inputs);
    expect(presented).toMatchObject({ category: 'other', detail: WITHHELD_DETAIL });
    expectNothingSensitive(presented);
  });

  it('describes aborts and reader errors without a message', () => {
    expect(presentLoadError({ type: 'abort' }, inputs).category).toBe('aborted');
    expect(presentLoadError({ type: 'error', error: { type: 'error' } }, inputs).category).toBe(
      'read'
    );
    expect(presentLoadError({ type: 'error', error: 42 }, inputs).category).toBe('read');
  });
});
