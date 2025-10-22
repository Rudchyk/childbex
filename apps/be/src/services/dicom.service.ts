import fs from 'node:fs';
import dicomParser from 'dicom-parser';

interface SliceMeta {
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
}

interface ClusterSlice {
  file: string;
  sopInstanceUID: string;
  positionScalar: number;
  group?: string;
  studyDate?: Date;
  rows: number;
  cols: number;
  pixelSpacing?: [number, number];
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
  broken: { file: string; reason: string }[];
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

function parseDicom(filePath: string): SliceMeta | null {
  const buffer = fs.readFileSync(filePath);
  const byteArray = new Uint8Array(buffer);
  let dataSet: dicomParser.DataSet;
  try {
    dataSet = dicomParser.parseDicom(byteArray);
  } catch {
    return null;
  }

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

  // PixelData check
  let validPixelData = true;
  let reason: string | undefined;
  const pixelElement = (dataSet.elements as any).x7fe00010;
  if (!pixelElement) {
    validPixelData = false;
    reason = 'pixeldata_missing';
  } else {
    const expectedBytes = rows * cols * samplesPerPixel * (bitsAllocated / 8);
    if (expectedBytes > 0 && pixelElement.length < expectedBytes) {
      validPixelData = false;
      reason = `pixeldata_size(expected=${expectedBytes},actual=${pixelElement.length})`;
    }
  }

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
  };
}

export function clusterByOrientation(
  files: string[],
  opts?: {
    tolOrientation?: number;
    tolPixelSpacing?: number;
    separateGeometry?: boolean;
  }
): ClusterResult {
  const {
    tolOrientation = 1e-3,
    tolPixelSpacing = 1e-6,
    separateGeometry = false,
  } = opts || {};

  const metas: SliceMeta[] = [];
  const broken: { file: string; reason: string }[] = [];

  for (const f of files) {
    const meta = parseDicom(f);
    if (!meta) {
      broken.push({ file: f, reason: 'parse_failed' });
      continue;
    }
    if (!meta.validPixelData) {
      broken.push({ file: f, reason: meta.reason || 'pixeldata_invalid' });
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
      f.positionScalar =
        meta.position[0] * cl.normal[0] +
        meta.position[1] * cl.normal[1] +
        meta.position[2] * cl.normal[2];
    });
    // Відсортувати
    cl.files.sort((a, b) => a.positionScalar - b.positionScalar);
  }

  return { clusters, broken };
}
