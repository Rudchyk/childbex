import type dicomParser from 'dicom-parser';

/**
 * DICOM metadata stored on `PatientImage` (backend-internal; not part of the
 * API). Every value is `null` when the tag is missing or malformed: nothing
 * is replaced by a default (e.g. a missing RescaleSlope stays `null`).
 */
export interface PatientImageDicomMetadata {
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  sopClassUid: string | null;
  modality: string | null;
  imageType: string[] | null;
  seriesNumber: number | null;
  instanceNumber: number | null;
  frameOfReferenceUid: string | null;
  /** Free text: never log it. */
  seriesDescription: string | null;
  convolutionKernel: string | null;
  imagePositionPatient: number[] | null;
  imageOrientationPatient: number[] | null;
  /** Position along the cluster's slice normal (the current sort key). */
  slicePosition: number | null;
  rows: number | null;
  columns: number | null;
  pixelSpacing: number[] | null;
  sliceThickness: number | null;
  rescaleSlope: number | null;
  rescaleIntercept: number | null;
  photometricInterpretation: string | null;
  bitsStored: number | null;
  pixelRepresentation: number | null;
  numberOfFrames: number | null;
  /** From the file meta header; `null` without one (it would be a guess). */
  transferSyntaxUid: string | null;
  /** Lowercase hex SHA-256 of the file bytes as stored. */
  fileSha256: string | null;
  fileSize: number | null;
}

/** Excluded from API responses (the metadata is backend-internal). */
export const patientImageDicomMetadataAttributes = [
  'studyInstanceUid',
  'seriesInstanceUid',
  'sopInstanceUid',
  'sopClassUid',
  'modality',
  'imageType',
  'seriesNumber',
  'instanceNumber',
  'frameOfReferenceUid',
  'seriesDescription',
  'convolutionKernel',
  'imagePositionPatient',
  'imageOrientationPatient',
  'slicePosition',
  'rows',
  'columns',
  'pixelSpacing',
  'sliceThickness',
  'rescaleSlope',
  'rescaleIntercept',
  'photometricInterpretation',
  'bitsStored',
  'pixelRepresentation',
  'numberOfFrames',
  'transferSyntaxUid',
  'fileSha256',
  'fileSize',
] as const satisfies readonly (keyof PatientImageDicomMetadata)[];

/** The stored metadata that is read from the data set itself. */
export type DataSetImageMetadata = Omit<
  PatientImageDicomMetadata,
  'slicePosition' | 'fileSha256' | 'fileSize'
>;

/**
 * Everything read from the data set. `fileOnly` values are needed to
 * evaluate a file (or later, a series) but are not stored per image.
 */
export interface ParsedDicomMetadata {
  image: DataSetImageMetadata;
  /**
   * Fields whose tag is present with a value that could not be read (e.g. a
   * UID with letters); they are `null` in `image`, like missing ones.
   */
  malformed: (keyof DataSetImageMetadata)[];
  fileOnly: {
    /** Free text; kept for the future Series model. Never log it. */
    contrastBolusAgent: string | null;
    bitsAllocated: number | null;
    highBit: number | null;
    samplesPerPixel: number | null;
  };
}

const UID_PATTERN = /^[0-9]+(\.[0-9]+)*$/;
const INTEGER_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const INT32_MAX = 2 ** 31 - 1;

/** Readers that return `null` for missing or malformed values. */
const readers = (dataSet: dicomParser.DataSet) => {
  const text = (tag: string): string | null => {
    if (!dataSet.elements[tag]) return null;
    // Values are padded with spaces (or NUL for UIDs).
    const value = dataSet.string(tag)?.replace(/[\s\0]+$/, '').trim();
    return value ? value : null;
  };
  const values = (tag: string) =>
    text(tag)
      ?.split('\\')
      .map((value) => value.trim()) ?? null;

  const uid = (tag: string) => {
    const value = text(tag);
    return value && value.length <= 64 && UID_PATTERN.test(value)
      ? value
      : null;
  };
  /** Code String: at most 16 characters. */
  const code = (tag: string) => {
    const value = text(tag);
    return value && value.length <= 16 ? value : null;
  };
  const codes = (tag: string) => {
    const list = values(tag)?.filter(Boolean);
    return list?.length ? list : null;
  };
  /** Integer String. */
  const integer = (tag: string) => {
    const value = text(tag);
    if (!value || !INTEGER_PATTERN.test(value)) return null;
    const number = Number(value);
    return Math.abs(number) <= INT32_MAX ? number : null;
  };
  /** Decimal String with exactly `count` values. */
  const decimals = (tag: string, count: number) => {
    const list = values(tag);
    if (list?.length !== count) return null;
    if (!list.every((value) => DECIMAL_PATTERN.test(value))) return null;
    const numbers = list.map(Number);
    return numbers.every(Number.isFinite) ? numbers : null;
  };
  const decimal = (tag: string) => decimals(tag, 1)?.[0] ?? null;
  /** Unsigned short (binary). */
  const ushort = (tag: string) =>
    dataSet.elements[tag]?.length === 2 ? dataSet.uint16(tag) ?? null : null;

  return { text, uid, code, codes, integer, decimals, decimal, ushort };
};

/** Reads the metadata of one data set defensively (never throws). */
export const readDicomMetadata = (
  dataSet: dicomParser.DataSet,
  { hasFileMeta }: { hasFileMeta: boolean }
): ParsedDicomMetadata => {
  const r = readers(dataSet);
  const malformed: ParsedDicomMetadata['malformed'] = [];
  /** Reads one field, noting a present but unreadable value. */
  const field = <T>(
    name: keyof DataSetImageMetadata,
    tag: string,
    read: (tag: string) => T | null
  ): T | null => {
    const value = read(tag);
    if (value === null && r.text(tag) !== null) malformed.push(name);
    return value;
  };

  const image: DataSetImageMetadata = {
    studyInstanceUid: field('studyInstanceUid', 'x0020000d', r.uid),
    seriesInstanceUid: field('seriesInstanceUid', 'x0020000e', r.uid),
    sopInstanceUid: field('sopInstanceUid', 'x00080018', r.uid),
    sopClassUid: field('sopClassUid', 'x00080016', r.uid),
    modality: field('modality', 'x00080060', r.code),
    imageType: field('imageType', 'x00080008', r.codes),
    seriesNumber: field('seriesNumber', 'x00200011', r.integer),
    instanceNumber: field('instanceNumber', 'x00200013', r.integer),
    frameOfReferenceUid: field('frameOfReferenceUid', 'x00200052', r.uid),
    seriesDescription: field('seriesDescription', 'x0008103e', r.text),
    convolutionKernel: field('convolutionKernel', 'x00181210', r.text),
    imagePositionPatient: field('imagePositionPatient', 'x00200032', (tag) =>
      r.decimals(tag, 3)
    ),
    imageOrientationPatient: field(
      'imageOrientationPatient',
      'x00200037',
      (tag) => r.decimals(tag, 6)
    ),
    rows: field('rows', 'x00280010', r.ushort),
    columns: field('columns', 'x00280011', r.ushort),
    pixelSpacing: field('pixelSpacing', 'x00280030', (tag) =>
      r.decimals(tag, 2)
    ),
    sliceThickness: field('sliceThickness', 'x00180050', r.decimal),
    rescaleSlope: field('rescaleSlope', 'x00281053', r.decimal),
    rescaleIntercept: field('rescaleIntercept', 'x00281052', r.decimal),
    photometricInterpretation: field(
      'photometricInterpretation',
      'x00280004',
      r.code
    ),
    bitsStored: field('bitsStored', 'x00280101', r.ushort),
    pixelRepresentation: field('pixelRepresentation', 'x00280103', r.ushort),
    numberOfFrames: field('numberOfFrames', 'x00280008', r.integer),
    // Without a file meta header the transfer syntax is not recorded in
    // the file; the one the parser succeeded with is only a guess.
    transferSyntaxUid: hasFileMeta
      ? field('transferSyntaxUid', 'x00020010', r.uid)
      : null,
  };

  return {
    image,
    malformed,
    fileOnly: {
      contrastBolusAgent: r.text('x00180010'),
      bitsAllocated: r.ushort('x00280100'),
      highBit: r.ushort('x00280102'),
      samplesPerPixel: r.ushort('x00280002'),
    },
  };
};

/** The metadata stored on `PatientImage` for one parsed file. */
export const toPatientImageDicomMetadata = (
  parsed: ParsedDicomMetadata,
  file: { sha256: string; size: number },
  slicePosition: number | null
): PatientImageDicomMetadata => ({
  ...parsed.image,
  slicePosition,
  fileSha256: file.sha256,
  fileSize: file.size,
});
