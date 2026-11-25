import type { DicomLoadErrorEvent } from './DicomViewer.types';

/**
 * dwv's load error messages can carry DICOM values, patient details
 * included: `Image.appendSlice` reports "Cannot append a slice with
 * different PatientName: <first> != <this>" for every attribute it compares
 * (patient name, ID, birth date and sex, study and series dates, times,
 * descriptions and IDs, referring physician, device serial number, …), the
 * metadata merge reports Instance Numbers, the loaders file names and the
 * full request URL. A file name or URL can itself identify the patient or
 * carry a token.
 *
 * So nothing raw is shown: each error is reduced here, once, to a category
 * and a fixed text chosen from an allowlist of dwv's own messages
 * (attribute names and HTTP status codes only, never values); any other
 * message gets a fixed generic text. Its input is named by its position in
 * the load ("Input 3 of 40"), never by file name or URL. Which file or URL
 * it was stays with the viewer (load accounting, slice mapping).
 */
export type LoadErrorCategory =
  | 'aborted'
  | 'slice-mismatch'
  | 'metadata'
  | 'request'
  | 'read'
  | 'invalid'
  | 'stale'
  | 'other';

/** A load error as the viewer shows it (no raw dwv message, name or URL). */
export interface DicomLoadError {
  dataid?: string;
  /** dwv event type: `error` or `abort`. */
  type: string;
  loadtype?: string;
  /** Which input of the load, by position ("Input 3 of 40"). */
  source: string;
  category: LoadErrorCategory;
  /** What happened, in a few words. */
  label: string;
  /** Fixed details (no DICOM values). */
  detail: string;
}

const LABELS: Record<LoadErrorCategory, string> = {
  aborted: 'Loading cancelled',
  'slice-mismatch': 'Not added: differs from the first image',
  metadata: 'Image shown, DICOM details incomplete',
  request: 'Not added: request failed',
  read: 'Not added: could not be read',
  invalid: 'Not added: not a supported DICOM image',
  stale: 'Belongs to a removed load',
  other: 'Load error',
};

/** For any message that is not one of dwv's known ones. */
export const WITHHELD_DETAIL = 'dwv could not load this input (details withheld).';

/** dwv 0.35's own messages that carry no value we show: fixed texts. */
const KNOWN: { pattern: RegExp; category: LoadErrorCategory; detail: string }[] = [
  {
    pattern: /^Cannot append a slice with different (number of columns|number of rows|orientation)$/,
    category: 'slice-mismatch',
    detail: 'Different $1.',
  },
  {
    pattern: /^Cannot append (null slice|more than one slice)$/,
    category: 'slice-mismatch',
    detail: 'Not a single slice.',
  },
  {
    pattern: /^(Cannot merge object|The first object already contains|Id key not found|Id value not found)\b/,
    category: 'metadata',
    detail:
      'dwv added the image but could not merge its DICOM details ' +
      '(duplicate or missing Instance Number).',
  },
  { pattern: /^Cannot find data to update\b/, category: 'stale', detail: '' },
  { pattern: /^No loader found for\b/, category: 'invalid', detail: 'No viewer loader for this input.' },
  { pattern: /^Input (file|url|data) of different type\b/, category: 'invalid', detail: 'Another type than the other inputs.' },
  { pattern: /^Not a valid DICOM file\b/, category: 'invalid', detail: 'Not a valid DICOM file.' },
  { pattern: /^No pixel data in DICOM file$/, category: 'invalid', detail: 'No pixel data.' },
  { pattern: /^No image rows or columns in DICOM file$/, category: 'invalid', detail: 'No image rows or columns.' },
  { pattern: /^Unsupported DICOM transfer syntax\b/, category: 'invalid', detail: 'Unsupported transfer syntax.' },
  { pattern: /^Unsupported bits allocated\b/, category: 'invalid', detail: 'Unsupported bits allocated.' },
  {
    pattern: /^(Problem while parsing, bad offset|Underestimated buffer size|Unknown VR type)\b/,
    category: 'invalid',
    detail: 'Damaged DICOM file (could not be parsed).',
  },
];

/** dwv's compared attributes: names only (`Cannot append … different X: …`). */
const ATTRIBUTE_MISMATCH = /^Cannot append a slice with different ([A-Za-z]{1,64}):/;

/** The message of dwv's `error` field: an Error, a string or an event. */
const messageOf = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
};

const classify = (
  event: Pick<DicomLoadErrorEvent, 'type' | 'error'>
): { category: LoadErrorCategory; detail: string } => {
  if (event.type === 'abort') return { category: 'aborted', detail: '' };
  const message = messageOf(event.error);
  if (!message) return { category: 'read', detail: '' };

  for (const { pattern, category, detail } of KNOWN) {
    const match = pattern.exec(message);
    if (match) return { category, detail: detail.replace('$1', match[1] ?? '') };
  }
  const attribute = ATTRIBUTE_MISMATCH.exec(message);
  if (attribute) {
    return {
      category: 'slice-mismatch',
      detail: `Different ${attribute[1]} (values not shown).`,
    };
  }
  // dwv's URL loader: "GET <url> <status> (<status text>)".
  const request = /^GET \S+ (\d{3})\b/.exec(message);
  if (request) return { category: 'request', detail: `HTTP ${request[1]}.` };
  return { category: 'other', detail: WITHHELD_DETAIL };
};

/** The input of an error, by its position in the load (never its name). */
const inputLabel = (source: unknown, inputs: readonly unknown[]) => {
  if (source === undefined) return 'Whole load';
  const index = inputs.indexOf(source);
  return index < 0 ? 'Unidentified input' : `Input ${index + 1} of ${inputs.length}`;
};

/**
 * The one place dwv's `error` / `abort` events become displayable.
 * `inputs`: the files or URLs handed to dwv for this load.
 */
export const presentLoadError = (
  event: DicomLoadErrorEvent,
  inputs: readonly unknown[]
): DicomLoadError => {
  const { category, detail } = classify(event);
  return {
    dataid: event.dataid === undefined ? undefined : `${event.dataid}`,
    type: event.type,
    loadtype: event.loadtype,
    source: inputLabel(event.source, inputs),
    category,
    label: LABELS[category],
    detail,
  };
};
