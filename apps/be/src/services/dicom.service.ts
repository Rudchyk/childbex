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
  seriesDescription?: string;
  studyDate?: Date;
  metadata: ParsedDicomMetadata;
  fileInfo: DicomFileInfo;
}

export interface ClusterSlice {
  file: string;
  sopInstanceUID: string;
  positionScalar: number;
  group?: string;
  studyDate?: Date;
  rows: number;
  cols: number;
  pixelSpacing?: [number, number];
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

export interface Cluster {
  id: number;
  normal: [number, number, number];
  files: ClusterSlice[];
  studyDate?: Date;
  group?: string;
  geometry: {
    rows: number;
    cols: number;
    pixelSpacing?: [number, number];
  };
  outliers?: { file: string; reason: string }[];
}

export interface ClusterResult {
  clusters: Cluster[];
  broken: BrokenImage[];
  /** Files that are not usable DICOM images (unrelated files, non-image objects). */
  skipped: { file: string; reason: string }[];
}

export const brokenImageClusterName = 'broken';

function parseDicomDateTime(
  dateStr?: string,
  timeStr?: string
): Date | undefined {
  if (!dateStr || !timeStr) return;

  // Extract parts
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6)) - 1; // JS months are 0-based
  const day = parseInt(dateStr.slice(6, 8));

  const hour = parseInt(timeStr.slice(0, 2) || '0');
  const minute = parseInt(timeStr.slice(2, 4) || '0');
  const second = parseInt(timeStr.slice(4, 6) || '0');
  const ms = parseFloat('0.' + (timeStr.split('.')[1] || '0')) * 1000;

  return new Date(year, month, day, hour, minute, second, ms);
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
  const seriesDescription = getStr('x0008103e');
  const studyDate = getStr('x00080020'); // Tag (0008,0020)
  const studyTime = getStr('x00080030'); // Study Time tag

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
    seriesDescription,
    studyDate: parseDicomDateTime(studyDate, studyTime),
    metadata: readDicomMetadata(dataSet, { hasFileMeta }),
    fileInfo,
  };
}

/**
 * Files are read one at a time (sequentially), so only one DICOM file is in
 * memory at once and the event loop is never blocked by file I/O.
 */
export async function clusterByOrientation(
  files: string[],
  opts?: {
    tolOrientation?: number;
    tolPixelSpacing?: number;
    separateGeometry?: boolean;
  }
): Promise<ClusterResult> {
  const {
    tolOrientation = 1e-3,
    tolPixelSpacing = 1e-6,
    separateGeometry = false,
  } = opts || {};

  const metas: SliceMeta[] = [];
  const broken: BrokenImage[] = [];
  const skipped: { file: string; reason: string }[] = [];

  for (const f of files) {
    const parsed = await parseDicomFile(f);
    if (!parsed.meta) {
      // Unrelated or non-image files are skipped, not reported as broken images.
      skipped.push({ file: f, reason: parsed.reason });
      continue;
    }
    const { meta } = parsed;
    if (!meta.validPixelData) {
      broken.push({
        file: f,
        reason: meta.reason || 'pixeldata_invalid',
        metadata: meta.metadata,
        fileInfo: meta.fileInfo,
      });
      continue;
    }
    metas.push(meta);
  }

  const clusters: Cluster[] = [];
  let clusterId = 0;

  function fitsCluster(m: SliceMeta, cluster: Cluster): boolean {
    // Перевіряємо орієнтацію
    const n = cluster.normal;
    const dot = n[0] * m.normal[0] + n[1] * m.normal[1] + n[2] * m.normal[2];
    if (Math.abs(dot) < 1 - tolOrientation) return false;

    if (separateGeometry) {
      // Geometry must match
      if (cluster.geometry.rows !== m.rows || cluster.geometry.cols !== m.cols)
        return false;
      const psA = cluster.geometry.pixelSpacing;
      const psB = m.pixelSpacing;
      if (psA && psB) {
        if (
          Math.abs(psA[0] - psB[0]) > tolPixelSpacing ||
          Math.abs(psA[1] - psB[1]) > tolPixelSpacing
        ) {
          return false;
        }
      } else if (psA || psB) {
        // один має pixelSpacing, інший ні
        return false;
      }
    }
    if (cluster.group !== m.seriesDescription) {
      return false;
    }
    return true;
  }

  for (const m of metas) {
    let assigned = false;
    for (const cl of clusters) {
      if (fitsCluster(m, cl)) {
        const posScalar =
          m.position[0] * cl.normal[0] +
          m.position[1] * cl.normal[1] +
          m.position[2] * cl.normal[2];
        // Геометрія: якщо не separateGeometry, але відрізняється — записати outlier
        if (!separateGeometry) {
          const g = cl.geometry;
          const geomMismatch =
            g.rows !== m.rows ||
            g.cols !== m.cols ||
            (g.pixelSpacing &&
              m.pixelSpacing &&
              (Math.abs(g.pixelSpacing[0] - m.pixelSpacing[0]) >
                tolPixelSpacing ||
                Math.abs(g.pixelSpacing[1] - m.pixelSpacing[1]) >
                  tolPixelSpacing)) ||
            (g.pixelSpacing && !m.pixelSpacing) ||
            (!g.pixelSpacing && m.pixelSpacing);
          if (geomMismatch) {
            cl.outliers = cl.outliers || [];
            cl.outliers.push({ file: m.file, reason: 'geometry_outlier' });
            assigned = true;
            break;
          }
        }
        cl.files.push({
          file: m.file,
          group: m.seriesDescription,
          sopInstanceUID: m.sopInstanceUID,
          positionScalar: posScalar,
          rows: m.rows,
          cols: m.cols,
          pixelSpacing: m.pixelSpacing,
          metadata: m.metadata,
          fileInfo: m.fileInfo,
        });
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      // Створюємо новий кластер
      const posScalar = 0; // тимчасово, перерахуємо після
      clusters.push({
        id: clusterId++,
        group: m.seriesDescription,
        studyDate: m.studyDate,
        normal: [...m.normal],
        files: [
          {
            file: m.file,
            sopInstanceUID: m.sopInstanceUID,
            group: m.seriesDescription,
            studyDate: m.studyDate,
            positionScalar: posScalar,
            rows: m.rows,
            cols: m.cols,
            pixelSpacing: m.pixelSpacing,
            metadata: m.metadata,
            fileInfo: m.fileInfo,
          },
        ],
        geometry: {
          rows: m.rows,
          cols: m.cols,
          pixelSpacing: m.pixelSpacing,
        },
      });
    }
  }

  // Переобчислити positionScalar всередині кожного кластеру за його normal
  for (const cl of clusters) {
    cl.files.forEach((f) => {
      // Нам треба знайти position оригінального SliceMeta
      const meta = metas.find((m) => m.file === f.file)!;
      f.positionScalar = positionAlongNormal(meta.position, cl.normal);
    });
    // Відсортувати
    cl.files.sort((a, b) => a.positionScalar - b.positionScalar);
  }

  return { clusters, broken, skipped };
}
