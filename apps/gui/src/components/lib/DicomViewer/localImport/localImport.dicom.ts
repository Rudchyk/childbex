import type dicomParserModule from 'dicom-parser';
import { readBlobBytes, sniffContent } from './localImport.files';

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
import type { DicomInstanceInfo, SkipReason } from './localImport.types';

/** Header bytes read first; most headers end well before this. */
const HEAD_BYTES = 256 * 1024;
const PIXEL_DATA = 'x7fe00010';
const MEDIA_STORAGE_DIRECTORY_SOP_CLASS = '1.2.840.10008.1.3.10';
const IMPLICIT_VR_LE = '1.2.840.10008.1.2';
const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';

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

/**
 * Classifies a file by its DICOM header: an image instance with its
 * identifying UIDs, or why it is skipped. Never relies on the file name.
 */
export const probeDicom = async (file: Blob): Promise<DicomProbe> => {
  let bytes: Uint8Array;
  try {
    bytes = await readBlobBytes(file.size > HEAD_BYTES ? file.slice(0, HEAD_BYTES) : file);
  } catch {
    return { kind: 'skipped', reason: 'unreadable' };
  }
  if (sniffContent(bytes) !== 'dicom') return { kind: 'skipped', reason: 'not-dicom' };
  const hasPreamble =
    bytes.length >= 132 &&
    String.fromCharCode(...bytes.subarray(128, 132)) === 'DICM';
  const isPartial = bytes.length < file.size;
  const dicomParser = await loadParser();

  let dataSet: DataSet | undefined;
  try {
    dataSet = parseHeader(dicomParser, bytes, hasPreamble);
  } catch {
    dataSet = undefined;
  }
  // The header continues after the first bytes: read the whole file.
  if (isPartial && (!dataSet || !dataSet.elements[PIXEL_DATA])) {
    try {
      bytes = await readBlobBytes(file);
      dataSet = parseHeader(dicomParser, bytes, hasPreamble);
    } catch {
      dataSet = undefined;
    }
  }
  if (!dataSet) {
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
    },
  };
};
