import type dicomParserModule from 'dicom-parser';
import { readBlobBytes, sniffContent } from './localImport.files';
import type { DicomInstanceInfo, SkipReason } from './localImport.types';

type DicomParser = typeof dicomParserModule;

let parserPromise: Promise<DicomParser> | undefined;
/** Loaded on the first local import only (not part of the main bundle). */
const loadParser = () =>
  (parserPromise ??= import('dicom-parser').then(
    (module) => ((module as { default?: DicomParser }).default ?? module) as DicomParser,
    (error: unknown) => {
      // Not cached: Retry loads it again (e.g. after a network hiccup).
      parserPromise = undefined;
      throw error;
    }
  ));

/**
 * Bytes read to find the end of the header (Pixel Data): most headers end
 * within the first step; a longer one is read again with more bytes, up to
 * the last step. A header that does not end there is not read further.
 */
export const HEADER_READ_STEPS = [256 * 1024, 2 * 1024 * 1024, 16 * 1024 * 1024];
const PIXEL_DATA = 'x7fe00010';
const MEDIA_STORAGE_DIRECTORY_SOP_CLASS = '1.2.840.10008.1.3.10';
const IMPLICIT_VR_LE = '1.2.840.10008.1.2';
const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';

/**
 * Attributes dwv 0.35 requires to be equal for every slice it appends to a
 * stack (`Image.appendSlice`), shown when a Series has to be split.
 */
const STACK_ATTRIBUTES: Record<string, string> = {
  Modality: 'x00080060',
  'SOP Class UID': 'x00080016',
  'Media Storage SOP Class UID': 'x00020002',
  'Transfer Syntax UID': 'x00020010',
  'Image Type': 'x00080008',
  'Samples per Pixel': 'x00280002',
  'Photometric Interpretation': 'x00280004',
  'Bits Allocated': 'x00280100',
  'Bits Stored': 'x00280101',
  'High Bit': 'x00280102',
  'Pixel Representation': 'x00280103',
  'VOI LUT Function': 'x00281056',
  'Lossy Image Compression': 'x00282110',
  'Frame of Reference UID': 'x00200052',
};
const US_ATTRIBUTES = new Set(['x00280002', 'x00280100', 'x00280101', 'x00280102', 'x00280103']);
/**
 * dwv's length unit (also compared) is millimetres when one of these has
 * two values, pixels otherwise (`getPixelSpacing`).
 */
const SPACING_TAGS = ['x00280030', 'x00181164', 'x00182010', 'x00280034'];

/**
 * The other attributes dwv compares between slices (patient, study and
 * device details). Only a fingerprint of them is kept.
 */
const FINGERPRINT_TAGS = [
  'x00100010', // Patient's Name
  'x00100020', // Patient ID
  'x00100030', // Patient's Birth Date
  'x00100040', // Patient's Sex
  'x00080020', // Study Date
  'x00080030', // Study Time
  'x00200010', // Study ID
  'x00081030', // Study Description
  'x00080090', // Referring Physician's Name
  'x00080021', // Series Date
  'x00080031', // Series Time
  'x00200011', // Series Number
  'x00080070', // Manufacturer
  'x00081090', // Manufacturer's Model Name
  'x00181000', // Device Serial Number
  'x00181020', // Software Versions
];

export type DicomProbe =
  | { kind: 'instance'; info: DicomInstanceInfo }
  | { kind: 'skipped'; reason: SkipReason };

const isUpperLetter = (byte: number) => byte >= 0x41 && byte <= 0x5a;

/**
 * Parses the data set up to Pixel Data (pixel data is not read). Throws
 * when the bytes end inside the header.
 */
const parseHeader = (dicomParser: DicomParser, bytes: Uint8Array, hasPreamble: boolean) => {
  if (hasPreamble) return dicomParser.parseDicom(bytes, { untilTag: PIXEL_DATA });
  // No Part 10 header (as dwv accepts): explicit VR when the first
  // element has a VR, implicit otherwise.
  const explicit = isUpperLetter(bytes[4]) && isUpperLetter(bytes[5]);
  return dicomParser.parseDicom(bytes, {
    untilTag: PIXEL_DATA,
    TransferSyntaxUID: explicit ? EXPLICIT_VR_LE : IMPLICIT_VR_LE,
  });
};

/** dicom-parser's error for bytes that end inside an element. */
const isTruncation = (error: unknown) => {
  const cause = (error as { exception?: unknown } | null)?.exception ?? error;
  const message = typeof cause === 'string' ? cause : (cause as Error | null)?.message ?? '';
  return /past end of buffer|overread|overrun/.test(message);
};

type DataSet = ReturnType<DicomParser['parseDicom']>;

const text = (dataSet: DataSet, tag: string) => {
  try {
    const value = dataSet.string(tag)?.replace(/\0/g, '').trim();
    return value || undefined;
  } catch {
    return undefined;
  }
};

const integer = (dataSet: DataSet, tag: string) => {
  const value = Number.parseInt(text(dataSet, tag) ?? '', 10);
  return Number.isFinite(value) ? value : undefined;
};

const ushort = (dataSet: DataSet, tag: string) => {
  try {
    const element = dataSet.elements[tag];
    return element && element.length >= 2 ? dataSet.uint16(tag) : undefined;
  } catch {
    return undefined;
  }
};

/** Multi-valued decimal string (e.g. `1\0\0\0\1\0`). */
const decimals = (dataSet: DataSet, tag: string, count: number) => {
  const values = (text(dataSet, tag) ?? '').split('\\').map(Number);
  return values.length === count && values.every(Number.isFinite) ? values : undefined;
};

/** 53-bit string hash (cyrb53): equal inputs, equal outputs. */
const fingerprint = (value: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

/**
 * dwv compares the first value of a multi-valued attribute only (`safeGet`),
 * e.g. `ORIGINAL` of `ORIGINAL\PRIMARY\AXIAL`.
 */
const firstValue = (dataSet: DataSet, tag: string) =>
  text(dataSet, tag)?.split('\\')[0].trim() || undefined;

const stackAttributesOf = (dataSet: DataSet, rows: number, columns: number) => {
  const attributes: Record<string, string> = {
    'Image size': `${columns} × ${rows}`,
    'Pixel spacing': SPACING_TAGS.some((tag) => text(dataSet, tag)?.split('\\').length === 2)
      ? 'known (mm)'
      : 'unknown (pixels)',
  };
  for (const [name, tag] of Object.entries(STACK_ATTRIBUTES)) {
    const value = US_ATTRIBUTES.has(tag) ? ushort(dataSet, tag)?.toString() : firstValue(dataSet, tag);
    if (value !== undefined) attributes[name] = value;
  }
  return attributes;
};

/**
 * Reads the header in growing steps until Pixel Data is reached. Returns
 * `too-large` when the header does not end within the last step.
 */
const readHeader = async (dicomParser: DicomParser, file: Blob, hasPreamble: boolean) => {
  for (const limit of HEADER_READ_STEPS) {
    const isPartial = file.size > limit;
    const bytes = await readBlobBytes(isPartial ? file.slice(0, limit) : file);
    let dataSet: DataSet;
    try {
      dataSet = parseHeader(dicomParser, bytes, hasPreamble);
    } catch (error) {
      // Damaged, or the bytes end inside an element: read more.
      if (isPartial && isTruncation(error)) continue;
      return 'invalid' as const;
    }
    if (!isPartial || dataSet.elements[PIXEL_DATA]) return dataSet;
  }
  return 'too-large' as const;
};

/**
 * Classifies a file by its DICOM header: an image instance with its
 * identifying UIDs, or why it is skipped. Never relies on the file name.
 */
export const probeDicom = async (file: Blob): Promise<DicomProbe> => {
  let head: Uint8Array;
  try {
    head = await readBlobBytes(file.slice(0, 132));
  } catch {
    return { kind: 'skipped', reason: 'unreadable' };
  }
  if (sniffContent(head) !== 'dicom') return { kind: 'skipped', reason: 'not-dicom' };
  const hasPreamble =
    head.length >= 132 && String.fromCharCode(...head.subarray(128, 132)) === 'DICM';
  const dicomParser = await loadParser();

  let dataSet: DataSet | 'invalid' | 'too-large';
  try {
    dataSet = await readHeader(dicomParser, file, hasPreamble);
  } catch {
    return { kind: 'skipped', reason: 'unreadable' };
  }
  if (dataSet === 'too-large') return { kind: 'skipped', reason: 'header-too-large' };
  if (dataSet === 'invalid') {
    // Without the DICM magic, a group 0008 start is only a guess.
    return { kind: 'skipped', reason: hasPreamble ? 'invalid-dicom' : 'not-dicom' };
  }

  const sopClassUid = text(dataSet, 'x00080016') ?? text(dataSet, 'x00020002');
  if (sopClassUid === MEDIA_STORAGE_DIRECTORY_SOP_CLASS) {
    return { kind: 'skipped', reason: 'dicomdir' };
  }
  const rows = ushort(dataSet, 'x00280010');
  const columns = ushort(dataSet, 'x00280011');
  if (!dataSet.elements[PIXEL_DATA] || !rows || !columns) {
    return { kind: 'skipped', reason: 'not-image' };
  }
  const studyInstanceUid = text(dataSet, 'x0020000d');
  const seriesInstanceUid = text(dataSet, 'x0020000e');
  const sopInstanceUid = text(dataSet, 'x00080018') ?? text(dataSet, 'x00020003');
  if (!studyInstanceUid || !seriesInstanceUid || !sopInstanceUid) {
    return { kind: 'skipped', reason: 'missing-uid' };
  }
  const header = dataSet;
  const position = decimals(dataSet, 'x00200032', 3);
  return {
    kind: 'instance',
    info: {
      studyInstanceUid,
      seriesInstanceUid,
      sopInstanceUid,
      sopClassUid,
      modality: text(dataSet, 'x00080060'),
      studyDate: text(dataSet, 'x00080020'),
      studyDescription: text(dataSet, 'x00081030'),
      seriesNumber: integer(dataSet, 'x00200011'),
      seriesDescription: text(dataSet, 'x0008103e'),
      instanceNumber: integer(dataSet, 'x00200013'),
      rows,
      columns,
      numberOfFrames: integer(dataSet, 'x00280008') ?? 1,
      stackAttributes: stackAttributesOf(dataSet, rows, columns),
      headerFingerprint: fingerprint(
        FINGERPRINT_TAGS.map((tag) => firstValue(header, tag) ?? '').join('\u0001')
      ),
      orientation: decimals(dataSet, 'x00200037', 6),
      position: position?.join(','),
    },
  };
};
