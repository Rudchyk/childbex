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
  return {
    image: {
      studyInstanceUid: r.uid('x0020000d'),
      seriesInstanceUid: r.uid('x0020000e'),
      sopInstanceUid: r.uid('x00080018'),
      sopClassUid: r.uid('x00080016'),
      modality: r.code('x00080060'),
      imageType: r.codes('x00080008'),
      seriesNumber: r.integer('x00200011'),
      instanceNumber: r.integer('x00200013'),
      frameOfReferenceUid: r.uid('x00200052'),
      seriesDescription: r.text('x0008103e'),
      convolutionKernel: r.text('x00181210'),
      imagePositionPatient: r.decimals('x00200032', 3),
      imageOrientationPatient: r.decimals('x00200037', 6),
      rows: r.ushort('x00280010'),
      columns: r.ushort('x00280011'),
      pixelSpacing: r.decimals('x00280030', 2),
      sliceThickness: r.decimal('x00180050'),
      rescaleSlope: r.decimal('x00281053'),
      rescaleIntercept: r.decimal('x00281052'),
      photometricInterpretation: r.code('x00280004'),
      bitsStored: r.ushort('x00280101'),
      pixelRepresentation: r.ushort('x00280103'),
      numberOfFrames: r.integer('x00280008'),
      // Without a file meta header the transfer syntax is not recorded in
      // the file; the one the parser succeeded with is only a guess.
      transferSyntaxUid: hasFileMeta ? r.uid('x00020010') : null,
    },
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
