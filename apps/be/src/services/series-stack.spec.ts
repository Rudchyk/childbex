/** Series image order and single-stack detection (pure). */
import {
  isSimpleStack,
  orderSeriesImages,
  sliceNormal,
  type StackImage,
} from './series-stack';

const AXIAL = [1, 0, 0, 0, 1, 0]; // normal (0, 0, 1)
const SAGITTAL = [0, 1, 0, 0, 0, -1]; // normal (-1, 0, 0)
const CORONAL = [1, 0, 0, 0, 0, -1]; // normal (0, 1, 0)

const image = (
  id: string,
  overrides: Partial<StackImage> & { z?: number; x?: number } = {}
): StackImage => {
  const { z = 0, x = 0, ...rest } = overrides;
  return {
    id,
    isBroken: false,
    instanceNumber: null,
    imageOrientationPatient: AXIAL,
    imagePositionPatient: [x, 0, z],
    numberOfFrames: 1,
    ...rest,
  };
};

const ids = (images: StackImage[]) =>
  orderSeriesImages(images).images.map(({ image }) => image.id);

describe('sliceNormal', () => {
  it('is the unit cross product of the row and column directions', () => {
    expect(sliceNormal(AXIAL)).toEqual([0, 0, 1]);
    expect(sliceNormal([2, 0, 0, 0, 2, 0])).toEqual([0, 0, 1]);
  });

  it.each([[null], [[1, 0, 0]], [[1, 0, 0, 1, 0, 0]], [[1, 0, 0, 0, NaN, 0]]])(
    'is null for an unusable orientation %j',
    (iop) => {
      expect(sliceNormal(iop)).toBeNull();
    }
  );
});

describe('orderSeriesImages', () => {
  it('orders by position along the normal, not by instance number or insertion', () => {
    expect(
      ids([
        image('c', { z: 10, instanceNumber: 1 }),
        image('a', { z: -5, instanceNumber: 3 }),
        image('b', { z: 2.5, instanceNumber: 2 }),
      ])
    ).toEqual(['a', 'b', 'c']);
  });

  it('breaks position ties by instance number, then id', () => {
    expect(
      ids([
        image('d', { z: 1, instanceNumber: 2 }),
        image('c', { z: 1, instanceNumber: 1 }),
        image('b', { z: 1, instanceNumber: null }),
        image('a', { z: 1, instanceNumber: null }),
      ])
    ).toEqual(['c', 'd', 'a', 'b']);
  });

  it('falls back to instance number when the position is missing', () => {
    expect(
      ids([
        image('x', { imagePositionPatient: null, instanceNumber: 2 }),
        image('y', { imagePositionPatient: null, instanceNumber: 1 }),
        image('z', { z: 0 }),
      ])
    ).toEqual(['z', 'y', 'x']);
  });

  it('is independent of the input order', () => {
    const images = [
      image('1', { z: 3 }),
      image('2', { z: 1 }),
      image('3', { z: 2, isBroken: true, instanceNumber: 1 }),
      image('4', { z: 1, instanceNumber: 7 }),
    ];
    const expected = ids(images);
    expect(ids([...images].reverse())).toEqual(expected);
    expect(ids([images[2], images[0], images[3], images[1]])).toEqual(expected);
  });

  it('treats opposite normals as one orientation', () => {
    const stack = orderSeriesImages([
      image('a', { z: 1 }),
      image('b', { z: 2, imageOrientationPatient: [1, 0, 0, 0, -1, 0] }),
    ]);
    expect(stack.orientationCount).toBe(1);
  });

  it('groups orientations (first image by instance number first) and flags the series', () => {
    const stack = orderSeriesImages([
      image('sag2', { imageOrientationPatient: SAGITTAL, x: 5, instanceNumber: 5 }),
      image('ax2', { z: 20, instanceNumber: 2 }),
      image('ax1', { z: 10, instanceNumber: 3 }),
      image('sag1', { imageOrientationPatient: SAGITTAL, x: 9, instanceNumber: 4 }),
      image('cor', { imageOrientationPatient: CORONAL, instanceNumber: 1 }),
    ]);
    expect(stack.images.map(({ image: { id }, orientationGroup }) => [id, orientationGroup])).toEqual([
      ['cor', 0],
      ['ax1', 1],
      ['ax2', 1],
      // Normal (-1, 0, 0): x = 9 comes first.
      ['sag1', 2],
      ['sag2', 2],
    ]);
    expect(stack.orientationCount).toBe(3);
    expect(isSimpleStack(stack)).toBe(false);
  });

  it('puts broken images last (no group) and leaves them out of the stack checks', () => {
    const stack = orderSeriesImages([
      image('broken', {
        isBroken: true,
        imageOrientationPatient: SAGITTAL,
        numberOfFrames: 20,
        instanceNumber: 1,
      }),
      image('a', { z: 1 }),
    ]);
    expect(stack.images.map(({ image: { id }, orientationGroup }) => [id, orientationGroup])).toEqual([
      ['a', 0],
      ['broken', null],
    ]);
    expect(stack).toMatchObject({ orientationCount: 1, multiFrameImageCount: 0 });
    expect(isSimpleStack(stack)).toBe(true);
  });

  it('counts multi-frame images: not a simple stack', () => {
    const stack = orderSeriesImages([
      image('a', { z: 1 }),
      image('mf', { z: 2, numberOfFrames: 30 }),
    ]);
    expect(stack).toMatchObject({ orientationCount: 1, multiFrameImageCount: 1 });
    expect(isSimpleStack(stack)).toBe(false);
  });

  it('images without a usable orientation are a separate group', () => {
    const stack = orderSeriesImages([
      image('a', { z: 1 }),
      image('n', { imageOrientationPatient: null, instanceNumber: 1 }),
    ]);
    expect(stack.orientationCount).toBe(2);
    expect(isSimpleStack(orderSeriesImages([image('n', { imageOrientationPatient: null })]))).toBe(true);
  });

  it('an empty series is a (trivial) simple stack', () => {
    expect(orderSeriesImages([])).toEqual({ images: [], orientationCount: 0, multiFrameImageCount: 0 });
  });
});
