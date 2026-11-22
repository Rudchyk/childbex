import type { DicomLoadErrorEvent } from './DicomViewer.types';

/**
 * dwv's load error messages can carry DICOM values, patient details
 * included: `Image.appendSlice` reports "Cannot append a slice with
 * different PatientName: <first> != <this>" for every attribute it compares
 * (patient name, ID, birth date and sex, study and series dates, times,
 * descriptions and IDs, referring physician, device serial number, …), the
 * metadata merge reports Instance Numbers and the URL loader the full
 * request URL. So a raw message is never shown: each error is reduced here,
 * once, to a category and a fixed text (attribute names and HTTP status
 * codes only, never compared values).
 */
export type LoadErrorCategory =
  | 'aborted'
  | 'slice-mismatch'
  | 'metadata'
  | 'request'
  | 'read'
  | 'stale'
  | 'other';

/** A load error as the viewer shows it (no raw dwv message). */
export interface DicomLoadError {
  dataid?: string;
  /** dwv event type: `error` or `abort`. */
  type: string;
  loadtype?: string;
  /** The file name, or the URL handed to dwv. */
  source?: string;
  category: LoadErrorCategory;
  /** What happened, in a few words. */
  label: string;
  /** Safe details (no DICOM values). */
  detail: string;
}

const LABELS: Record<LoadErrorCategory, string> = {
  aborted: 'Loading cancelled',
  'slice-mismatch': 'Not added: differs from the first image',
  metadata: 'Image shown, DICOM details incomplete',
  request: 'Not added: request failed',
  read: 'Not added: could not be read',
  stale: 'Belongs to a removed load',
  other: 'Load error',
};

/** The message of dwv's `error` field: an Error, a string or an event. */
const messageOf = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : '';
};

/** Text before the first value (`:`), without anything that looks like one. */
const safePrefix = (message: string) =>
  message.split(':')[0].replace(/\s+/g, ' ').trim().slice(0, 120);

const classify = (
  event: Pick<DicomLoadErrorEvent, 'type' | 'error'>
): { category: LoadErrorCategory; detail: string } => {
  if (event.type === 'abort') return { category: 'aborted', detail: '' };
  const message = messageOf(event.error);
  if (!message) return { category: 'read', detail: '' };

  const sizeOrOrientation =
    /^Cannot append a slice with different (number of columns|number of rows|orientation)$/.exec(
      message
    );
  if (sizeOrOrientation) {
    return { category: 'slice-mismatch', detail: `Different ${sizeOrOrientation[1]}.` };
  }
  const attribute = /^Cannot append a slice with different ([^:]*)/.exec(message);
  if (attribute) {
    const name = /^[A-Za-z]{1,64}$/.test(attribute[1]) ? attribute[1] : 'attribute';
    return {
      category: 'slice-mismatch',
      detail: `Different ${name} (values not shown).`,
    };
  }
  if (
    /^(Cannot merge object|The first object already contains|Id key not found|Id value not found)/.test(
      message
    )
  ) {
    return {
      category: 'metadata',
      detail:
        'dwv added the image but could not merge its DICOM details ' +
        '(duplicate or missing Instance Number).',
    };
  }
  if (/^Cannot find data to update/.test(message)) return { category: 'stale', detail: '' };
  const request = /^GET \S+ (\d{3})\b/.exec(message);
  if (request) return { category: 'request', detail: `HTTP ${request[1]}.` };
  return { category: 'other', detail: safePrefix(message) };
};

/** The one place dwv's `error` / `abort` events become displayable. */
export const presentLoadError = (event: DicomLoadErrorEvent): DicomLoadError => {
  const { category, detail } = classify(event);
  return {
    dataid: event.dataid === undefined ? undefined : `${event.dataid}`,
    type: event.type,
    loadtype: event.loadtype,
    source: event.source instanceof File ? event.source.name : event.source,
    category,
    label: LABELS[category],
    detail,
  };
};
