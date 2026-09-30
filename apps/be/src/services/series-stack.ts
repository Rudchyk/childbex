/**
 * Order of the images of a DICOM Series, and whether the Series is a single
 * simple stack (pure; no database access).
 *
 * The viewer (dwv) shows one volume of single-frame slices with one
 * orientation and one geometry. A Series is reviewable as a whole (viewer,
 * Series "Finish review") only when, among its non-broken images:
 *   orientationCount == 1 && multiFrameImageCount == 0
 *   && geometryCount == 1 && geometryIncompleteCount == 0
 * (a 3-plane localizer, a multi-frame image, images of different size or
 * pixel spacing, or an image without complete geometry are not). The API,
 * the GUI and Finish review all use `isSimpleStack`.
 *
 * Order (deterministic):
 *   1. non-broken images, by orientation group: images whose slice normals
 *      are parallel (|n1·n2| >= 1 - 1e-3, the importer's tolerance) form a
 *      group; groups in the order of their first image by (instanceNumber,
 *      id); images without a usable orientation form one extra group;
 *   2. within a group: position along the group's normal
 *      (ImagePositionPatient · normal of its first image), then
 *      instanceNumber, then id (missing values last);
 *   3. broken images last (never displayed), by instanceNumber, then id.
 */

export const ORIENTATION_TOLERANCE = 1e-3;

export interface StackImage {
  id: string;
  isBroken: boolean;
  instanceNumber: number | null;
  imageOrientationPatient: readonly number[] | null;
  imagePositionPatient: readonly number[] | null;
  numberOfFrames: number | null;
  rows: number | null;
  columns: number | null;
  pixelSpacing: readonly number[] | null;
}

type Vector = [number, number, number];

const finite = (values: readonly number[] | null, length: number) =>
  !!values &&
  values.length === length &&
  values.every((value) => typeof value === 'number' && Number.isFinite(value));

/** Unit slice normal from ImageOrientationPatient, or null. */
export const sliceNormal = (iop: readonly number[] | null): Vector | null => {
  if (!finite(iop, 6)) return null;
  const [r0, r1, r2, c0, c1, c2] = iop as number[];
  const normal: Vector = [r1 * c2 - r2 * c1, r2 * c0 - r0 * c2, r0 * c1 - r1 * c0];
  const length = Math.hypot(...normal);
  if (!(length > 0)) return null;
  return [normal[0] / length, normal[1] / length, normal[2] / length];
};

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Ascending, missing values last. */
const compareNullable = (a: number | null, b: number | null) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : a - b;

const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byInstance = (a: StackImage, b: StackImage) =>
  compareNullable(a.instanceNumber, b.instanceNumber) || compareId(a.id, b.id);

export interface OrderedStackImage<T extends StackImage> {
  image: T;
  /** Index of the orientation group; null for broken images. */
  orientationGroup: number | null;
}

export interface SeriesStack<T extends StackImage> {
  images: OrderedStackImage<T>[];
  /** Orientation groups among the non-broken images. */
  orientationCount: number;
  /** Non-broken images with more than one frame. */
  multiFrameImageCount: number;
  /** Distinct (rows, columns, pixel spacing) among complete non-broken images. */
  geometryCount: number;
  /**
   * Non-broken images without complete geometry (rows, columns, pixel
   * spacing, orientation or position missing / unusable).
   */
  geometryIncompleteCount: number;
}

/** Pixel spacing is compared to 1e-6 mm (the importer's tolerance). */
const geometryKey = (image: StackImage) =>
  finite(image.pixelSpacing, 2) &&
  typeof image.rows === 'number' &&
  image.rows > 0 &&
  typeof image.columns === 'number' &&
  image.columns > 0 &&
  sliceNormal(image.imageOrientationPatient) &&
  finite(image.imagePositionPatient, 3)
    ? [
        image.rows,
        image.columns,
        ...(image.pixelSpacing as number[]).map((value) => Math.round(value * 1e6)),
      ].join(':')
    : null;

export const orderSeriesImages = <T extends StackImage>(
  images: readonly T[]
): SeriesStack<T> => {
  const displayable = images.filter((image) => !image.isBroken).sort(byInstance);
  const groups: { normal: Vector | null; members: T[] }[] = [];
  for (const image of displayable) {
    const normal = sliceNormal(image.imageOrientationPatient);
    const group = groups.find((candidate) =>
      normal && candidate.normal
        ? Math.abs(dot(candidate.normal, normal)) >= 1 - ORIENTATION_TOLERANCE
        : !normal && !candidate.normal
    );
    if (group) group.members.push(image);
    else groups.push({ normal, members: [image] });
  }

  const ordered: OrderedStackImage<T>[] = [];
  groups.forEach(({ normal, members }, orientationGroup) => {
    const position = (image: T) =>
      normal && finite(image.imagePositionPatient, 3)
        ? dot(image.imagePositionPatient as number[], normal)
        : null;
    const keyed = members.map((image) => ({ image, position: position(image) }));
    keyed.sort(
      (a, b) =>
        compareNullable(a.position, b.position) || byInstance(a.image, b.image)
    );
    for (const { image } of keyed) ordered.push({ image, orientationGroup });
  });
  for (const image of images.filter((candidate) => candidate.isBroken).sort(byInstance)) {
    ordered.push({ image, orientationGroup: null });
  }

  const keys = displayable.map(geometryKey);
  return {
    images: ordered,
    orientationCount: groups.length,
    multiFrameImageCount: displayable.filter(
      (image) => (image.numberOfFrames ?? 1) > 1
    ).length,
    geometryCount: new Set(keys.filter((key) => key !== null)).size,
    geometryIncompleteCount: keys.filter((key) => key === null).length,
  };
};

/**
 * The Series is one complete simple stack: the viewer shows all of its
 * (non-broken) images, so it can be reviewed and finished as a whole.
 */
export const isSimpleStack = ({
  orientationCount,
  multiFrameImageCount,
  geometryCount,
  geometryIncompleteCount,
}: Omit<SeriesStack<StackImage>, 'images'>) =>
  orientationCount === 1 &&
  multiFrameImageCount === 0 &&
  geometryCount === 1 &&
  geometryIncompleteCount === 0;
