import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import dicomParser from 'dicom-parser';
import { readDicomMetadata, type ParsedDicomMetadata } from './dicom.metadata';

/** The file as stored (it is placed byte-for-byte into the uploads). */
export interface DicomFileInfo {
  /** Lowercase hex SHA-256 of the file bytes. */
  sha256: string;
  size: number;
}

export interface SliceMeta {
  file: string;
  sopInstanceUID: string;
  normal: [number, number, number];
  position: [number, number, number];
  rows: number;
  cols: number;
  pixelSpacing?: [number, number];
  validPixelData: boolean;
  reason?: string;
  metadata: ParsedDicomMetadata;
  fileInfo: DicomFileInfo;
}

/** A DICOM image whose pixel data is missing or truncated. */
export interface BrokenImage {
  file: string;
  reason: string;
  metadata: ParsedDicomMetadata;
  fileInfo: DicomFileInfo;
}

/** A usable DICOM image of an archive (valid pixel data and geometry). */
export interface ParsedImage {
  file: string;
  /** ImagePositionPatient along the image's own slice normal. */
  positionScalar: number;
  metadata: ParsedDicomMetadata;
  fileInfo: DicomFileInfo;
}

export interface ParsedArchive {
  images: ParsedImage[];
  broken: BrokenImage[];
  /**
   * Files that are not usable DICOM images (unrelated files, non-image
   * objects, images without a Study / Series Instance UID).
   */
  skipped: { file: string; reason: string }[];
}

// Transfer syntaxes tried for datasets stored without the Part-10 header
// (no preamble / "DICM" marker): implicit VR LE (the DICOM default) and
// explicit VR LE.
const RAW_DATASET_TRANSFER_SYNTAXES = [
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
];

const hasPart10Marker = (bytes: Uint8Array) =>
  bytes.length >= 132 &&
  bytes[128] === 0x44 && // D
  bytes[129] === 0x49 && // I
  bytes[130] === 0x43 && // C
  bytes[131] === 0x4d; // M

export type DicomFileParseResult =
  | { meta: SliceMeta }
  | { meta: null; reason: string };

/**
 * Position of a slice along a slice normal (ImagePositionPatient projected
 * on it): the sort key within a cluster, stored as `slicePosition`.
 */
export const positionAlongNormal = (
  position: readonly number[],
  normal: readonly number[]
) =>
  position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];

/** Reads and parses one file (the import and the metadata backfill). */
export async function parseDicomFile(
  filePath: string
): Promise<DicomFileParseResult> {
  // Asynchronous read keeps the event loop responsive while large studies
  // are processed; a Buffer already is a Uint8Array (no copy needed).
  const byteArray = await readFile(filePath);
  // Hashed from the bytes already in memory for parsing: the stored file is
  // a hard link or byte-for-byte copy of this file.
  const fileInfo: DicomFileInfo = {
    sha256: createHash('sha256').update(byteArray).digest('hex'),
    size: byteArray.length,
  };

  // The "DICM" marker only selects the parsing strategy; files without it are
  // still accepted when they parse as a usable raw DICOM dataset.
  if (hasPart10Marker(byteArray)) {
    try {
      const meta = readSliceMeta(
        filePath,
        dicomParser.parseDicom(byteArray),
        fileInfo,
        true
      );
      return meta ? { meta } : { meta: null, reason: 'not_an_image' };
    } catch {
      return { meta: null, reason: 'dicom_parse_failed' };
    }
  }
  for (const TransferSyntaxUID of RAW_DATASET_TRANSFER_SYNTAXES) {
    try {
      const meta = readSliceMeta(
        filePath,
        dicomParser.parseDicom(byteArray, { TransferSyntaxUID }),
        fileInfo,
        false
      );
      if (meta) return { meta };
    } catch {
      // Not parseable with this transfer syntax.
    }
  }
  return { meta: null, reason: 'not_dicom' };
}

/** Length dicom-parser keeps when an undefined-length element is not closed. */
const UNDEFINED_LENGTH = 0xffffffff;

/**
 * Why the Pixel Data is unusable, or `undefined` when it is present.
 *
 * - Native pixel data must hold at least the uncompressed size
 *   (`expectedBytes`).
 * - Encapsulated pixel data (undefined length, split into fragments; written
 *   for compressed transfer syntaxes such as JPEG Lossless, JPEG-LS,
 *   JPEG 2000 or RLE) is recognized from its structure, as parsed by
 *   dicom-parser. Its encoded length is not comparable with the
 *   uncompressed size; it must contain at least one non-empty fragment and
 *   end with the sequence delimiter. It is not decoded here: whether a
 *   compressed image can be used later is a separate decision.
 */
export function pixelDataProblem(
  dataSet: dicomParser.DataSet,
  expectedBytes: number
): string | undefined {
  const pixelData = dataSet.elements.x7fe00010;
  if (!pixelData) return 'pixeldata_missing';

  if (pixelData.encapsulatedPixelData) {
    // Without the delimiter the file ended after a fragment: fragments of
    // the image may be missing, which cannot be detected.
    if (pixelData.length === UNDEFINED_LENGTH) return 'pixeldata_unterminated';
    const hasData = (pixelData.fragments ?? []).some(({ length }) => length > 0);
    return hasData ? undefined : 'pixeldata_empty_fragments';
  }

  if (expectedBytes > 0 && pixelData.length < expectedBytes) {
    return `pixeldata_size(expected=${expectedBytes},actual=${pixelData.length})`;
  }
  return undefined;
}

/**
 * Files without SOPInstanceUID, a complete ImagePositionPatient /
 * ImageOrientationPatient, Rows or Columns are not treated as images
 * (`null`: skipped as `not_an_image`); all other metadata is optional.
 */
function readSliceMeta(
  filePath: string,
  dataSet: dicomParser.DataSet,
  fileInfo: DicomFileInfo,
  hasFileMeta: boolean
): SliceMeta | null {
  const getStr = (tag: string) => dataSet.string(tag);
  const getFloats = (tag: string): number[] | undefined => {
    const str = getStr(tag);
    if (!str) return;
    const arr = str
      .split('\\')
      .map((s) => parseFloat(s))
      .filter((n) => !isNaN(n));
    return arr.length ? arr : undefined;
  };

  const sop = getStr('x00080018');
  const iop = getFloats('x00200037');
  const ipp = getFloats('x00200032');
  const rows = dataSet.uint16('x00280010');
  const cols = dataSet.uint16('x00280011');
  const bitsAllocated = dataSet.uint16('x00280100') || 0;
  const samplesPerPixel = dataSet.uint16('x00280002') || 1;

  if (
    !sop ||
    !iop ||
    iop.length !== 6 ||
    !ipp ||
    ipp.length !== 3 ||
    !rows ||
    !cols
  ) {
    return null;
  }

  const r: [number, number, number] = [iop[0], iop[1], iop[2]];
  const c: [number, number, number] = [iop[3], iop[4], iop[5]];
  const normal: [number, number, number] = [
    r[1] * c[2] - r[2] * c[1],
    r[2] * c[0] - r[0] * c[2],
    r[0] * c[1] - r[1] * c[0],
  ];
  const normLen = Math.hypot(...normal) || 1;
  normal[0] /= normLen;
  normal[1] /= normLen;
  normal[2] /= normLen;

  let pixelSpacing: [number, number] | undefined;
  const ps = getFloats('x00280030');
  if (ps && ps.length >= 2) pixelSpacing = [ps[0], ps[1]];

  const reason = pixelDataProblem(
    dataSet,
    rows * cols * samplesPerPixel * (bitsAllocated / 8)
  );
  const validPixelData = !reason;

  return {
    file: filePath,
    sopInstanceUID: sop,
    normal,
    position: [ipp[0], ipp[1], ipp[2]],
    rows,
    cols,
    pixelSpacing,
    validPixelData,
    reason,
    metadata: readDicomMetadata(dataSet, { hasFileMeta }),
    fileInfo,
  };
}

/**
 * Parses the files of an archive. Every image with valid pixel data and a
 * Study / Series Instance UID is kept, whatever its geometry (no grouping:
 * the image belongs to its DICOM Series). Images without those UIDs cannot
 * be placed in the hierarchy and are skipped (`missing_hierarchy_uid`),
 * broken ones included.
 *
 * Files are read one at a time (sequentially), so only one DICOM file is in
 * memory at once and the event loop is never blocked by file I/O.
 */
export async function parseArchiveFiles(files: string[]): Promise<ParsedArchive> {
  const images: ParsedImage[] = [];
  const broken: BrokenImage[] = [];
  const skipped: { file: string; reason: string }[] = [];

  for (const file of files) {
    const parsed = await parseDicomFile(file);
    if (!parsed.meta) {
      // Unrelated or non-image files are skipped, not reported as broken images.
      skipped.push({ file, reason: parsed.reason });
      continue;
    }
    const { meta } = parsed;
    const { studyInstanceUid, seriesInstanceUid } = meta.metadata.image;
    if (!studyInstanceUid || !seriesInstanceUid) {
      skipped.push({ file, reason: 'missing_hierarchy_uid' });
      continue;
    }
    if (!meta.validPixelData) {
      broken.push({
        file,
        reason: meta.reason || 'pixeldata_invalid',
        metadata: meta.metadata,
        fileInfo: meta.fileInfo,
      });
      continue;
    }
    images.push({
      file,
      positionScalar: positionAlongNormal(meta.position, meta.normal),
      metadata: meta.metadata,
      fileInfo: meta.fileInfo,
    });
  }

  return { images, broken, skipped };
}
