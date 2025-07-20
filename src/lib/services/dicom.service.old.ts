import fs from 'node:fs';
import dicomParser from 'dicom-parser';

interface SliceMeta {
  file: string;
  sopInstanceUID: string;
  seriesInstanceUID: string;
  normal: [number, number, number];
  position: [number, number, number];
  rows: number;
  cols: number;
  pixelSpacing?: [number, number];
  validPixelData: boolean;
  reason?: string;
}

interface ClusterSlice {
  file: string;
  sopInstanceUID: string;
  positionScalar: number;
  rows: number;
  cols: number;
  pixelSpacing?: [number, number];
}

interface Cluster {
  id: number;
  normal: [number, number, number];
  geometry: {
    rows: number;
    cols: number;
    pixelSpacing?: [number, number];
  };
  files: ClusterSlice[];
  outliers?: { file: string; reason: string }[];
}

interface SeriesClusters {
  seriesInstanceUID: string;
  clusters: Cluster[];
  primaryClusterId: number;
}

interface Result {
  series: SeriesClusters[];
  broken: { file: string; reason: string }[];
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
  const seriesUID = getStr('x0020000e');
  const iop = getFloats('x00200037');
  const ipp = getFloats('x00200032');
  const rows = dataSet.uint16('x00280010');
  const cols = dataSet.uint16('x00280011');
  const bitsAllocated = dataSet.uint16('x00280100') || 0;
  const samplesPerPixel = dataSet.uint16('x00280002') || 1;

  if (
    !sop ||
    !seriesUID ||
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
    seriesInstanceUID: seriesUID,
    normal,
    position: [ipp[0], ipp[1], ipp[2]],
    rows,
    cols,
    pixelSpacing,
    validPixelData,
    reason,
  };
}

export function clusterSeriesAndOrientation(
  files: string[],
  opts?: {
    tolOrientation?: number;
    tolPixelSpacing?: number;
    separateGeometry?: boolean;
    minClusterSize?: number;
  }
): Result {
  const {
    tolOrientation = 1e-3,
    tolPixelSpacing = 1e-6,
    separateGeometry = false,
    minClusterSize = 1,
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

  // Групування по SeriesInstanceUID
  const bySeries = new Map<string, SliceMeta[]>();
  for (const m of metas) {
    if (!bySeries.has(m.seriesInstanceUID)) {
      bySeries.set(m.seriesInstanceUID, []);
    }
    bySeries.get(m.seriesInstanceUID)!.push(m);
  }

  const series: SeriesClusters[] = [];
  let globalClusterCounter = 0; // (не обов'язково глобальний id, але можна зберегти)

  for (const [seriesUID, slices] of bySeries.entries()) {
    const clusters: Cluster[] = [];

    function fitsCluster(m: SliceMeta, cl: Cluster): boolean {
      const n = cl.normal;
      const dot = n[0] * m.normal[0] + n[1] * m.normal[1] + n[2] * m.normal[2];
      if (Math.abs(dot) < 1 - tolOrientation) return false;

      if (separateGeometry) {
        if (cl.geometry.rows !== m.rows || cl.geometry.cols !== m.cols)
          return false;
        const psA = cl.geometry.pixelSpacing;
        const psB = m.pixelSpacing;
        if (psA && psB) {
          if (
            Math.abs(psA[0] - psB[0]) > tolPixelSpacing ||
            Math.abs(psA[1] - psB[1]) > tolPixelSpacing
          )
            return false;
        } else if (psA || psB) {
          return false;
        }
      }
      return true;
    }

    for (const m of slices) {
      let assigned = false;
      for (const cl of clusters) {
        if (fitsCluster(m, cl)) {
          // Geometry outlier handling if not separateGeometry
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
          const posScalar =
            m.position[0] * cl.normal[0] +
            m.position[1] * cl.normal[1] +
            m.position[2] * cl.normal[2];
          cl.files.push({
            file: m.file,
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
        clusters.push({
          id: globalClusterCounter++,
          normal: [...m.normal],
          geometry: {
            rows: m.rows,
            cols: m.cols,
            pixelSpacing: m.pixelSpacing,
          },
          files: [
            {
              file: m.file,
              sopInstanceUID: m.sopInstanceUID,
              positionScalar: 0,
              rows: m.rows,
              cols: m.cols,
              pixelSpacing: m.pixelSpacing,
            },
          ],
        });
      }
    }

    // Перерахунок та сортування
    for (const cl of clusters) {
      cl.files.forEach((f) => {
        const meta = slices.find((s) => s.file === f.file)!;
        f.positionScalar =
          meta.position[0] * cl.normal[0] +
          meta.position[1] * cl.normal[1] +
          meta.position[2] * cl.normal[2];
      });
      cl.files.sort((a, b) => a.positionScalar - b.positionScalar);
    }

    // Видалити кластери, менші за поріг (або помістити їх у outliers?)
    const finalClusters = clusters.filter(
      (c) => c.files.length >= minClusterSize
    );
    // primary = найбільший
    const primaryClusterId = finalClusters.reduce(
      (acc, c) =>
        c.files.length >
        (finalClusters.find((x) => x.id === acc)?.files.length || 0)
          ? c.id
          : acc,
      finalClusters.length ? finalClusters[0].id : -1
    );

    series.push({
      seriesInstanceUID: seriesUID,
      clusters: finalClusters,
      primaryClusterId,
    });
  }

  return { series, broken };
}
