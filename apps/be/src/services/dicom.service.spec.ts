import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clusterByOrientation, type ClusterResult } from './dicom.service';
import {
  makeSyntheticDicom,
  SYNTHETIC_FRAME_OF_REFERENCE_UID,
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
  type SyntheticDicomOptions,
} from './archive/__fixtures__/synthetic';

let dir: string;
let files: string[];

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'childbex-dicom-'));
  files = [];
  // Written out of slice order: clustering must sort by position.
  for (const z of [3, 1, 4, 0, 2, 5, 7, 6]) {
    const file = path.join(dir, `IM${z}`);
    await writeFile(
      file,
      makeSyntheticDicom({ instance: z + 1, sliceZ: z, rows: 64, cols: 64 })
    );
    files.push(file);
  }
  const unrelated = path.join(dir, 'README.txt');
  await writeFile(unrelated, 'not a DICOM file');
  files.push(unrelated);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('clusterByOrientation', () => {
  it('keeps the event loop responsive while reading files', async () => {
    // Macrotasks (I/O callbacks, timers, other requests) can only run when
    // the event loop is not blocked. A synchronous implementation completes
    // before any of these ticks can run.
    let ticks = 0;
    let done = false;
    const spin = () => {
      if (done) return;
      ticks += 1;
      setImmediate(spin);
    };
    setImmediate(spin);

    const result = await clusterByOrientation(files);
    done = true;

    expect(result.clusters).toHaveLength(1);
    expect(ticks).toBeGreaterThan(0);
  });

  it('produces the same clustering result as before', async () => {
    const { clusters, broken, skipped } = await clusterByOrientation(files);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].group).toBe('SYNTHETIC AXIAL');
    expect(clusters[0].geometry).toEqual({
      rows: 64,
      cols: 64,
      pixelSpacing: [0.5, 0.5],
    });
    // Sorted by position along the slice normal.
    expect(clusters[0].files.map((f) => path.basename(f.file))).toEqual([
      'IM0',
      'IM1',
      'IM2',
      'IM3',
      'IM4',
      'IM5',
      'IM6',
      'IM7',
    ]);
    expect(broken).toEqual([]);
    expect(skipped).toEqual([
      { file: path.join(dir, 'README.txt'), reason: 'not_dicom' },
    ]);
  });
});

const JPEG_LOSSLESS = '1.2.840.10008.1.2.4.70';

describe('DICOM metadata', () => {
  let n = 0;
  /** Parses one synthetic file on its own. */
  const parse = async (options: SyntheticDicomOptions = {}) => {
    const bytes = makeSyntheticDicom({ rows: 8, cols: 8, ...options });
    const file = path.join(dir, `meta-${n++}`);
    await writeFile(file, bytes);
    return { bytes, file, result: await clusterByOrientation([file]) };
  };
  /** The single parsed image (clustered or broken). */
  const parseImage = async (options: SyntheticDicomOptions = {}) => {
    const { bytes, result } = await parse(options);
    const [image] = [
      ...result.clusters.flatMap(({ files }) => files),
      ...result.broken,
    ];
    return { bytes, image, result };
  };

  it('reads the identity UIDs and SOP class', async () => {
    const { image } = await parseImage({ instance: 3 });

    expect(image.metadata.image).toMatchObject({
      studyInstanceUid: SYNTHETIC_STUDY_UID,
      seriesInstanceUid: SYNTHETIC_SERIES_UID,
      sopInstanceUid: '2.25.10000000000000000000000003',
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2',
      frameOfReferenceUid: SYNTHETIC_FRAME_OF_REFERENCE_UID,
    });
  });

  it('reads modality and series attributes', async () => {
    const { image } = await parseImage({
      instance: 7,
      attributes: { ConvolutionKernel: 'B30f', SeriesNumber: '4' },
    });

    expect(image.metadata.image).toMatchObject({
      modality: 'CT',
      imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
      seriesNumber: 4,
      instanceNumber: 7,
      seriesDescription: 'SYNTHETIC AXIAL',
      convolutionKernel: 'B30f',
    });
  });

  it('reads the geometry', async () => {
    const { image } = await parseImage({
      sliceZ: -12.5,
      attributes: { PixelSpacing: '0.703125\\0.703125', SliceThickness: '5' },
    });

    expect(image.metadata.image).toMatchObject({
      imagePositionPatient: [0, 0, -12.5],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      rows: 8,
      columns: 8,
      pixelSpacing: [0.703125, 0.703125],
      sliceThickness: 5,
    });
  });

  it('reads the values needed for HU conversion', async () => {
    const { image } = await parseImage({
      attributes: { RescaleSlope: '1.5', RescaleIntercept: '-1000' },
      ushorts: { BitsStored: 16, HighBit: 15, PixelRepresentation: 1 },
    });

    expect(image.metadata.image).toMatchObject({
      rescaleSlope: 1.5,
      rescaleIntercept: -1000,
      photometricInterpretation: 'MONOCHROME2',
      bitsStored: 16,
      pixelRepresentation: 1,
      numberOfFrames: null,
    });
    expect(image.metadata.fileOnly).toEqual({
      contrastBolusAgent: null,
      bitsAllocated: 16,
      highBit: 15,
      samplesPerPixel: 1,
    });
  });

  it('reads the transfer syntax from the file meta header', async () => {
    const { image } = await parseImage();

    expect(image.metadata.image.transferSyntaxUid).toBe('1.2.840.10008.1.2.1');
  });

  it('skips a Part 10 file whose meta header lacks the transfer syntax (current behavior)', async () => {
    // dicom-parser requires (0002,0010) in a Part 10 header; the file is not
    // parsed with a guessed transfer syntax.
    const { result } = await parse({ transferSyntaxUid: null });

    expect(result.clusters).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'dicom_parse_failed' }),
    ]);
  });

  it.each([
    ['malformed', { transferSyntaxUid: 'not-a-uid' }],
    ['not recorded (no file meta header)', { part10: false }],
  ])(
    'stores no transfer syntax when it is %s, and still imports the file',
    async (_, options) => {
      const { image, result } = await parseImage(options);

      expect(result.clusters).toHaveLength(1);
      expect(image.metadata.image.transferSyntaxUid).toBeNull();
    }
  );

  it('keeps metadata and the transfer syntax of encapsulated (compressed) pixel data', async () => {
    const { image } = await parseImage({
      transferSyntaxUid: JPEG_LOSSLESS,
      encapsulatedPixelData: Buffer.alloc(20, 1),
    });

    expect(image.metadata.image).toMatchObject({
      transferSyntaxUid: JPEG_LOSSLESS,
      sopInstanceUid: expect.any(String),
      rescaleSlope: 1,
    });
  });

  it('reads NumberOfFrames of a multi-frame image without expanding frames', async () => {
    const { image, result } = await parseImage({
      attributes: {
        SOPClassUID: '1.2.840.10008.5.1.4.1.1.2.1', // Enhanced CT
        NumberOfFrames: '3',
      },
      pixelDataBytes: 8 * 8 * 2 * 3,
    });

    expect(result.clusters.flatMap(({ files }) => files)).toHaveLength(1);
    expect(image.metadata.image).toMatchObject({
      sopClassUid: '1.2.840.10008.5.1.4.1.1.2.1',
      numberOfFrames: 3,
    });
  });

  it('keeps ContrastBolusAgent in the parser output only', async () => {
    const { image } = await parseImage({
      attributes: { ContrastBolusAgent: 'SYNTHETIC AGENT' },
    });

    expect(image.metadata.fileOnly.contrastBolusAgent).toBe('SYNTHETIC AGENT');
    expect(image.metadata.image).not.toHaveProperty('contrastBolusAgent');
  });

  it('hashes the file bytes (lowercase hex SHA-256) and records the size', async () => {
    const { bytes, image } = await parseImage();

    expect(image.fileInfo).toEqual({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    });
    expect(image.fileInfo.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('leaves missing optional metadata null (no defaults) and still imports the file', async () => {
    const { image, result } = await parseImage({
      attributes: {
        StudyInstanceUID: null,
        SeriesInstanceUID: null,
        FrameOfReferenceUID: null,
        ImageType: null,
        SeriesNumber: null,
        InstanceNumber: null,
        ConvolutionKernel: null,
        SliceThickness: null,
        PixelSpacing: null,
        RescaleSlope: null,
        RescaleIntercept: null,
        PhotometricInterpretation: null,
        Modality: null,
      },
      ushorts: { BitsStored: null, PixelRepresentation: null },
    });

    expect(result.clusters).toHaveLength(1);
    expect(image.metadata.image).toMatchObject({
      studyInstanceUid: null,
      seriesInstanceUid: null,
      frameOfReferenceUid: null,
      imageType: null,
      seriesNumber: null,
      instanceNumber: null,
      convolutionKernel: null,
      sliceThickness: null,
      pixelSpacing: null,
      rescaleSlope: null,
      rescaleIntercept: null,
      photometricInterpretation: null,
      modality: null,
      bitsStored: null,
      pixelRepresentation: null,
    });
  });

  it('treats malformed values as missing instead of guessing', async () => {
    const { image, result } = await parseImage({
      attributes: {
        StudyInstanceUID: '1.2.X.4',
        InstanceNumber: 'first',
        RescaleSlope: '1,5',
        PixelSpacing: '0.5',
        SliceThickness: 'thick',
      },
    });

    expect(result.clusters).toHaveLength(1);
    expect(image.metadata.image).toMatchObject({
      studyInstanceUid: null,
      instanceNumber: null,
      rescaleSlope: null,
      pixelSpacing: null,
      sliceThickness: null,
    });
  });

  it('still skips files without ImagePositionPatient (current behavior)', async () => {
    const { result } = await parse({
      attributes: { ImagePositionPatient: null },
    });

    expect(result.clusters).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'not_an_image' }),
    ]);
  });
});

describe('pixel data validation', () => {
  let n = 0;
  /** Writes one synthetic 8x8 file and parses it on its own. */
  const parseBytes = async (bytes: Buffer) => {
    const file = path.join(dir, `pixels-${n++}`);
    await writeFile(file, bytes);
    return clusterByOrientation([file]);
  };
  const parse = (options: SyntheticDicomOptions = {}) =>
    parseBytes(makeSyntheticDicom({ rows: 8, cols: 8, ...options }));
  /** 8 x 8 x 16 bit = 128 bytes uncompressed. */
  const compressed = (encapsulatedPixelData: Buffer | Buffer[]) =>
    parse({ transferSyntaxUid: JPEG_LOSSLESS, encapsulatedPixelData });
  const clusteredCount = (result: ClusterResult) =>
    result.clusters.flatMap(({ files }) => files).length;

  describe('native (uncompressed) pixel data', () => {
    it('accepts complete pixel data', async () => {
      const result = await parse();

      expect(clusteredCount(result)).toBe(1);
      expect(result.broken).toEqual([]);
    });

    it('still reports truncated pixel data as broken', async () => {
      const result = await parse({ pixelDataBytes: 64 });

      expect(clusteredCount(result)).toBe(0);
      expect(result.broken).toEqual([
        expect.objectContaining({
          reason: 'pixeldata_size(expected=128,actual=64)',
        }),
      ]);
    });

    it('reports missing pixel data as broken', async () => {
      const bytes = makeSyntheticDicom({ rows: 8, cols: 8 });
      // Cut the file before the Pixel Data element (tag e0 7f 10 00).
      const pixelTag = bytes.lastIndexOf(Buffer.from([0xe0, 0x7f, 0x10, 0x00]));

      const result = await parseBytes(bytes.subarray(0, pixelTag));

      expect(result.broken).toEqual([
        expect.objectContaining({ reason: 'pixeldata_missing' }),
      ]);
    });
  });

  describe('encapsulated (compressed) pixel data', () => {
    it('accepts JPEG Lossless data smaller than the uncompressed size', async () => {
      const result = await compressed(Buffer.alloc(20, 1));

      expect(result.broken).toEqual([]);
      const [image] = result.clusters.flatMap(({ files }) => files);
      expect(image.metadata.image).toMatchObject({
        transferSyntaxUid: JPEG_LOSSLESS,
        sopInstanceUid: expect.any(String),
        rows: 8,
        columns: 8,
        rescaleSlope: 1,
        rescaleIntercept: -1024,
      });
      expect(image.fileInfo.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each([
      ['several fragments', [Buffer.alloc(6, 1), Buffer.alloc(10, 2)]],
      ['an empty fragment before a non-empty one', [Buffer.alloc(0), Buffer.alloc(8, 3)]],
      ['data larger than the uncompressed size', [Buffer.alloc(200, 4)]],
    ])('accepts %s', async (_, fragments) => {
      const result = await compressed(fragments);

      expect(clusteredCount(result)).toBe(1);
      expect(result.broken).toEqual([]);
    });

    it.each([
      ['only a basic offset table', []],
      ['only empty fragments', [Buffer.alloc(0), Buffer.alloc(0)]],
    ])('reports %s as broken, keeping the metadata', async (_, fragments) => {
      const result = await compressed(fragments);

      expect(clusteredCount(result)).toBe(0);
      expect(result.broken).toEqual([
        expect.objectContaining({ reason: 'pixeldata_empty_fragments' }),
      ]);
      expect(result.broken[0].metadata.image.transferSyntaxUid).toBe(
        JPEG_LOSSLESS
      );
      expect(result.broken[0].fileInfo.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reports pixel data without the sequence delimiter as broken', async () => {
      const bytes = makeSyntheticDicom({
        rows: 8,
        cols: 8,
        transferSyntaxUid: JPEG_LOSSLESS,
        encapsulatedPixelData: Buffer.alloc(20, 1),
      });

      // The file ends after the last fragment (8-byte delimiter removed).
      const result = await parseBytes(bytes.subarray(0, bytes.length - 8));

      expect(result.broken).toEqual([
        expect.objectContaining({ reason: 'pixeldata_unterminated' }),
      ]);
    });

    it('skips a file cut inside a fragment (unparseable, current behavior)', async () => {
      const bytes = makeSyntheticDicom({
        rows: 8,
        cols: 8,
        transferSyntaxUid: JPEG_LOSSLESS,
        encapsulatedPixelData: Buffer.alloc(20, 1),
      });

      const result = await parseBytes(bytes.subarray(0, bytes.length - 14));

      expect(result.broken).toEqual([]);
      expect(result.skipped).toEqual([
        expect.objectContaining({ reason: 'dicom_parse_failed' }),
      ]);
    });
  });
});
