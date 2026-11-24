/**
 * Local import end to end: folders (dropped or chosen) and ZIP archives
 * give the same Series, grouped by DICOM UIDs (not folder names), with
 * the original bytes, and junk or hostile input is reported, not loaded.
 */
import { TextDecoder } from 'util';
import { ReadableStream } from 'stream/web';
import { gzipSync } from 'fflate';
import { fakeDataTransfer, type FakeTree } from './__fixtures__/fakeEntries';
import { buildTar, type TarFixtureEntry } from './__fixtures__/syntheticTar';
import {
  TAR_STUDY_1,
  TAR_STUDY_2,
  TAR_STUDY_BZ2,
  TAR_STUDY_XZ,
  tarOf,
  tarSlice,
  tarStudy,
  ZEROS_XZ,
} from './__fixtures__/tarFixtures';
import {
  BASIC_TEXT_SR,
  buildZip,
  fileOf,
  folderFileOf,
  MEDIA_STORAGE_DIRECTORY,
  syntheticDicom,
  type SyntheticDicomOptions,
  type ZipFixtureEntry,
} from './__fixtures__/syntheticDicom';
import { readBlobBytes } from './localImport.files';
import { importLocalDicom, toDwvFile } from './localImport.pipeline';
import {
  selectionFromDataTransfer,
  selectionFromFileList,
  type InputSelection,
} from './localImport.sources';
import { LocalImportError, type LocalImportResult } from './localImport.types';

Object.assign(globalThis, {
  TextDecoder,
  // The browser's web streams (jsdom has none), used by the xz decoder.
  ReadableStream: globalThis.ReadableStream ?? ReadableStream,
});

const STUDY_1 = '2.25.100';
const STUDY_2 = '2.25.200';
const slice = (series: string, n: number, extra: SyntheticDicomOptions = {}) =>
  syntheticDicom({
    studyUid: series.startsWith(STUDY_2) ? STUDY_2 : STUDY_1,
    seriesUid: series,
    sopUid: `${series}.${n}`,
    instanceNumber: n,
    seriesNumber: Number(series.split('.').pop()),
    seriesDescription: `Series ${series}`,
    ...extra,
  });

const text = (value: string) => Uint8Array.from(value, (c) => c.charCodeAt(0));

/** The example of Issue #46, as relative path -> bytes. */
const exampleStudy = (): Record<string, Uint8Array> => ({
  'PatientStudy/Study_001/Series_001/IM000001': slice(`${STUDY_1}.1`, 1),
  'PatientStudy/Study_001/Series_001/IM000002': slice(`${STUDY_1}.1`, 2),
  'PatientStudy/Study_001/Series_001/IM000003': slice(`${STUDY_1}.1`, 3),
  'PatientStudy/Study_001/Series_002/IM000001.dcm': slice(`${STUDY_1}.2`, 1),
  'PatientStudy/Study_001/Series_002/IM000002.dcm': slice(`${STUDY_1}.2`, 2),
  'PatientStudy/Study_002/Series_001/000001': slice(`${STUDY_2}.1`, 1),
  'PatientStudy/Study_002/Series_001/000002': slice(`${STUDY_2}.1`, 2),
  'PatientStudy/DICOMDIR': syntheticDicom({ sopClassUid: MEDIA_STORAGE_DIRECTORY, pixels: false }),
  'PatientStudy/README.txt': text('Synthetic test study.\n'),
});

const toTree = (files: Record<string, Uint8Array>): FakeTree => {
  const root: FakeTree = {};
  for (const [path, bytes] of Object.entries(files)) {
    const segments = path.split('/');
    let node = root;
    for (const segment of segments.slice(0, -1)) {
      node = (node[segment] ??= {}) as FakeTree;
    }
    const name = segments[segments.length - 1];
    node[name] = fileOf(bytes, name);
  }
  return root;
};

const dropFolder = (files: Record<string, Uint8Array>) => {
  const [rootName, tree] = Object.entries(toTree(files))[0];
  return selectionFromDataTransfer(fakeDataTransfer([{ name: rootName, node: tree as FakeTree }]));
};
/** Several folders dropped together: folder name -> relative path -> bytes. */
const dropFolderTrees = (folders: Record<string, Record<string, Uint8Array>>) =>
  selectionFromDataTransfer(
    fakeDataTransfer(
      Object.entries(folders).map(([name, files]) => ({ name, node: toTree(files) }))
    )
  );
const pickFolder = (files: Record<string, Uint8Array>) =>
  selectionFromFileList(Object.entries(files).map(([path, bytes]) => folderFileOf(bytes, path)));
const zipOf = (files: Record<string, Uint8Array>, extra: ZipFixtureEntry[] = []) =>
  buildZip([...Object.entries(files).map(([name, data]) => ({ name, data })), ...extra]);
const pickFiles = (files: Record<string, Uint8Array>) =>
  selectionFromFileList(Object.entries(files).map(([name, bytes]) => fileOf(bytes, name)));

const summary = (result: LocalImportResult) => ({
  series: result.series.map((s) => ({
    study: s.studyInstanceUid,
    series: s.seriesInstanceUid,
    instances: s.instances.map((i) => i.info.sopInstanceUid),
  })),
  skipped: result.skipped.map((s) => s.reason).sort(),
});

/** Offsets of the local file headers (`PK\3\4`) of a synthetic ZIP. */
const localHeaderOffsets = (bytes: Uint8Array) => {
  const offsets: number[] = [];
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 3 && bytes[i + 3] === 4) {
      offsets.push(i);
    }
  }
  return offsets;
};

const run = (selection: InputSelection, options?: Parameters<typeof importLocalDicom>[1]) =>
  importLocalDicom(selection, options);

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(LocalImportError);
  return error as LocalImportError;
};

describe('importLocalDicom', () => {
  const expected = {
    series: [
      { study: STUDY_1, series: `${STUDY_1}.1`, instances: [1, 2, 3].map((n) => `${STUDY_1}.1.${n}`) },
      { study: STUDY_1, series: `${STUDY_1}.2`, instances: [1, 2].map((n) => `${STUDY_1}.2.${n}`) },
      { study: STUDY_2, series: `${STUDY_2}.1`, instances: [1, 2].map((n) => `${STUDY_2}.1.${n}`) },
    ],
    skipped: ['dicomdir', 'not-dicom'],
  };

  it('groups a dropped folder tree by Study and Series (extensionless files too)', async () => {
    const result = await run(dropFolder(exampleStudy()));
    expect(summary(result)).toEqual(expected);
    expect(result.fileCount).toBe(9);
    expect(result.instanceCount).toBe(7);
  });

  it('finds the same Series through the folder picker and in a ZIP archive', async () => {
    const study = exampleStudy();
    expect(summary(await run(pickFolder(study)))).toEqual(expected);

    const zipped = await run(pickFiles({ 'PatientStudy.zip': zipOf(study) }));
    expect(summary(zipped)).toEqual(expected);
    expect(zipped.series[0].instances[0].path).toBe(
      'PatientStudy.zip/PatientStudy/Study_001/Series_001/IM000001'
    );
  });

  it('keeps the original DICOM bytes (from disk and from a ZIP)', async () => {
    const study = exampleStudy();
    for (const selection of [pickFolder(study), pickFiles({ 's.zip': zipOf(study) })]) {
      const result = await run(selection);
      for (const instance of result.series.flatMap((s) => s.instances)) {
        const source = instance.path.replace(/^s\.zip\//, '');
        expect(await readBlobBytes(instance.file)).toEqual(study[source]);
      }
    }
  });

  it('never trusts folder names: Series come from the DICOM UIDs', async () => {
    const result = await run(
      pickFolder({
        // One folder with two Series, one Series across two folders.
        'Mixed/IM000001': slice(`${STUDY_1}.1`, 1),
        'Mixed/IM000002': slice(`${STUDY_1}.2`, 1),
        'Other/IM000001': slice(`${STUDY_1}.1`, 2),
      })
    );
    expect(summary(result).series).toEqual([
      { study: STUDY_1, series: `${STUDY_1}.1`, instances: [`${STUDY_1}.1.1`, `${STUDY_1}.1.2`] },
      { study: STUDY_1, series: `${STUDY_1}.2`, instances: [`${STUDY_1}.2.1`] },
    ]);
  });

  it('keeps files with the same name in different folders', async () => {
    const result = await run(
      pickFolder({
        'A/IM000001': slice(`${STUDY_1}.1`, 1),
        'B/IM000001': slice(`${STUDY_1}.1`, 2),
      })
    );
    expect(result.series[0].instances.map((i) => i.path)).toEqual(['A/IM000001', 'B/IM000001']);
  });

  it('orders instances by Instance Number, not by file name', async () => {
    const result = await run(
      pickFolder({
        'S/a': slice(`${STUDY_1}.1`, 10),
        'S/b': slice(`${STUDY_1}.1`, 2),
        'S/c': slice(`${STUDY_1}.1`, 1),
      })
    );
    expect(result.series[0].instances.map((i) => i.info.instanceNumber)).toEqual([1, 2, 10]);
  });

  it('skips junk, invalid and non-image DICOM with a reason for each', async () => {
    const result = await run(
      pickFolder({
        'S/IM1': slice(`${STUDY_1}.1`, 1),
        'S/.DS_Store': text('junk'),
        'S/Thumbs.db': text('junk'),
        'S/__MACOSX/._IM1': text('junk'),
        'S/photo.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
        'S/empty': new Uint8Array(0),
        'S/broken': new Uint8Array([...syntheticDicom().slice(0, 140), 0xff, 0xff, 0xff]),
        'S/report': syntheticDicom({ sopClassUid: BASIC_TEXT_SR, pixels: false, sopUid: '2.25.9' }),
        'S/no-uid': syntheticDicom({ seriesUid: '' }),
        'S/copy-of-IM1': slice(`${STUDY_1}.1`, 1),
      })
    );
    expect(result.instanceCount).toBe(1);
    expect(Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))).toEqual({
      'S/.DS_Store': 'system-file',
      'S/Thumbs.db': 'system-file',
      'S/__MACOSX/._IM1': 'system-file',
      'S/photo.jpg': 'not-dicom',
      'S/empty': 'not-dicom',
      'S/broken': 'invalid-dicom',
      'S/report': 'not-image',
      'S/no-uid': 'missing-uid',
      'S/copy-of-IM1': 'duplicate-instance',
    });
  });

  it('recognises DICOM without the Part 10 preamble (as dwv does)', async () => {
    const result = await run(pickFiles({ raw: slice(`${STUDY_1}.1`, 1, { part10: false }) }));
    expect(result.instanceCount).toBe(1);
    expect(result.series[0].instances[0].info.rows).toBe(4);
  });

  it('reads more of the file when the header is longer than the first bytes read', async () => {
    const result = await run(
      pickFiles({ big: slice(`${STUDY_1}.1`, 1, { privatePaddingBytes: 300 * 1024 }) })
    );
    expect(result.instanceCount).toBe(1);
  });

  it('reads headers in bounded steps and gives up on a header that does not end', async () => {
    const result = await run(
      pickFiles({
        // Pixel Data after 3 MiB: found by the third read (16 MiB cap).
        long: slice(`${STUDY_1}.1`, 1, { privatePaddingBytes: 3 * 1024 * 1024 }),
        // Pixel Data after 17 MiB: beyond the cap, not read further.
        endless: slice(`${STUDY_1}.1`, 2, { privatePaddingBytes: 17 * 1024 * 1024 }),
      })
    );
    expect(result.instanceCount).toBe(1);
    expect(summary(result).skipped).toEqual(['header-too-large']);
  });

  it('never reads more than the header cap of a large file', async () => {
    const bytes = slice(`${STUDY_1}.1`, 1, { privatePaddingBytes: 20 * 1024 * 1024 });
    const file = fileOf(bytes, 'IM1');
    const read = jest.spyOn(Blob.prototype, 'slice');
    try {
      await run(selectionFromFileList([file]));
      const ends = read.mock.calls.map(([, end]) => end ?? Infinity);
      expect(Math.max(...ends)).toBeLessThanOrEqual(16 * 1024 * 1024);
    } finally {
      read.mockRestore();
    }
  });

  describe('stacks dwv can load completely', () => {
    const SERIES = `${STUDY_1}.1`;
    const parts = (result: LocalImportResult) =>
      result.series.map((s) => ({
        part: s.part && `${s.part.index}/${s.part.count}`,
        instances: s.instances.map((i) => i.info.instanceNumber),
        values: s.part?.values,
      }));

    it('keeps a consistent Series in one stack that opens directly', async () => {
      const result = await run(
        pickFolder({ 'S/1': slice(SERIES, 1), 'S/2': slice(SERIES, 2), 'S/3': slice(SERIES, 3) })
      );
      expect(result.series).toHaveLength(1);
      expect(result.series[0].part).toBeUndefined();
      expect(result.series[0].warnings).toEqual([]);
    });

    it.each([
      ['image size', { rows: 8, columns: 8 }, 'Image size: 8 × 8'],
      // dwv compares the first value only (ORIGINAL / DERIVED).
      ['Image Type (derived)', { imageType: 'DERIVED\\SECONDARY\\MPR' }, 'Image Type: DERIVED'],
      ['Modality', { modality: 'MR' }, 'Modality: MR'],
      ['SOP Class', { sopClassUid: '1.2.840.10008.5.1.4.1.1.4' }, 'SOP Class UID: 1.2.840.10008.5.1.4.1.1.4'],
      ['Transfer Syntax', { transferSyntaxUid: '1.2.840.10008.1.2.4.70' }, 'Transfer Syntax UID: 1.2.840.10008.1.2.4.70'],
      ['Photometric Interpretation', { photometricInterpretation: 'MONOCHROME1' }, 'Photometric Interpretation: MONOCHROME1'],
      ['Bits Stored', { bitsStored: 16 }, 'Bits Stored: 16'],
      ['orientation (sagittal)', { orientation: '0\\1\\0\\0\\0\\-1' }, 'Orientation: 0\\1\\0\\0\\0\\-1'],
    ] as const)('splits a Series by %s into labelled parts', async (_label, odd, value) => {
      const result = await run(
        pickFolder({
          'S/1': slice(SERIES, 1),
          'S/2': slice(SERIES, 2, odd),
          'S/3': slice(SERIES, 3),
        })
      );
      expect(parts(result).map(({ part, instances }) => ({ part, instances }))).toEqual([
        { part: '1/2', instances: [1, 3] },
        { part: '2/2', instances: [2] },
      ]);
      expect(result.series[1].part?.values).toContain(value);
      // Same DICOM UIDs: parts of one Series, never another Series.
      expect(new Set(result.series.map((s) => s.seriesInstanceUid))).toEqual(new Set([SERIES]));
      expect(new Set(result.series.map((s) => s.key)).size).toBe(2);
    });

    it('keeps images whose Image Type differs after the first value in one stack', async () => {
      // dwv compares ORIGINAL / DERIVED only: a localizer value does not
      // stop it from stacking the slice.
      const result = await run(
        pickFolder({
          'S/1': slice(SERIES, 1),
          'S/2': slice(SERIES, 2, { imageType: 'ORIGINAL\\PRIMARY\\LOCALIZER' }),
        })
      );
      expect(result.series).toHaveLength(1);
      expect(result.series[0].part).toBeUndefined();
    });

    it('splits by pixel spacing presence (dwv compares the length unit)', async () => {
      const result = await run(
        pickFolder({
          'S/1': slice(SERIES, 1, { pixelSpacing: '0.7\\0.7' }),
          'S/2': slice(SERIES, 2),
          'S/3': slice(SERIES, 3, { pixelSpacing: '0.5\\0.5' }),
        })
      );
      // Different spacing values stay together: dwv compares the unit only.
      expect(parts(result).map(({ part, instances }) => ({ part, instances }))).toEqual([
        { part: '1/2', instances: [1, 3] },
        { part: '2/2', instances: [2] },
      ]);
      expect(result.series[1].part?.values).toContain('Pixel spacing: unknown (pixels)');
    });

    it('keeps orientations within dwv tolerance in one stack', async () => {
      const result = await run(
        pickFolder({
          'S/1': slice(SERIES, 1),
          'S/2': slice(SERIES, 2, { orientation: '1\\0.00001\\0\\0\\1\\0' }),
        })
      );
      expect(result.series).toHaveLength(1);
    });

    it('offers each multi-frame image on its own (dwv appends single slices only)', async () => {
      const result = await run(
        pickFolder({
          'US/1': slice(SERIES, 1, { modality: 'US', numberOfFrames: 3 }),
          'US/2': slice(SERIES, 2, { modality: 'US', numberOfFrames: 5 }),
        })
      );
      expect(parts(result)).toEqual([
        { part: '1/2', instances: [1], values: ['3 frames (instance 1)'] },
        { part: '2/2', instances: [2], values: ['5 frames (instance 2)'] },
      ]);
    });

    it('splits by other compared header details without showing them', async () => {
      const result = await run(
        pickFolder({
          'S/1': slice(SERIES, 1, { patientName: 'SYNTHETIC^ONE' }),
          'S/2': slice(SERIES, 2, { patientName: 'SYNTHETIC^TWO' }),
        })
      );
      expect(result.series).toHaveLength(2);
      expect(result.series[0].part?.differences).toEqual(['Patient, study or device details']);
      expect(JSON.stringify(result.series)).not.toMatch(/SYNTHETIC\^(ONE|TWO)/);
    });

    it('warns when several images share one position (only some may load)', async () => {
      const result = await run(
        pickFolder({
          'DWI/1': slice(SERIES, 1, { position: '0\\0\\0' }),
          'DWI/2': slice(SERIES, 2, { position: '0\\0\\0' }),
        })
      );
      expect(result.series).toHaveLength(1);
      expect(result.series[0].warnings).toEqual(['repeated-positions']);
    });
  });

  it('keeps pictures and videos for dwv\'s own loaders (as before), not DICOM', async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], 'photo.png', {
      type: 'image/png',
    });
    const video = new File([new Uint8Array(16)], 'clip.mp4', { type: 'video/mp4' });
    const json = new File(['{}'], 'state.json', { type: 'application/json' });
    const result = await run(
      selectionFromFileList([png, video, json, fileOf(slice(`${STUDY_1}.1`, 1), 'IM1')])
    );
    expect(result.mediaFiles.map((m) => [m.path, m.kind, m.file])).toEqual([
      ['photo.png', 'image', png],
      ['clip.mp4', 'video', video],
    ]);
    expect(result.instanceCount).toBe(1);
    expect(summary(result).skipped).toEqual(['not-dicom']);
  });

  it('keeps pictures and videos above the DICOM file size limit, as before', async () => {
    const video = new File([new Uint8Array(4096)], 'clip.mp4', { type: 'video/mp4' });
    const result = await run(selectionFromFileList([video]), { limits: { maxFileBytes: 1024 } });
    expect(result.mediaFiles.map((m) => m.file)).toEqual([video]);
    expect(result.skipped).toEqual([]);
    expect(result.incompleteSources).toEqual([]);
  });

  it('gives dwv names its DICOM loader accepts, without touching the bytes', async () => {
    const bytes = slice(`${STUDY_1}.1`, 1);
    const ima = toDwvFile(fileOf(bytes, 'IM0001.IMA'), 'IM0001.IMA');
    expect(ima.name).toBe('IM0001.IMA.dcm');
    expect(await readBlobBytes(ima)).toEqual(bytes);

    const uidNamed = fileOf(bytes, '1.2.840.113619.2.55');
    expect(toDwvFile(uidNamed, uidNamed.name)).toBe(uidNamed);
    const dcm = fileOf(bytes, 'IM1.DCM');
    expect(toDwvFile(dcm, dcm.name)).toBe(dcm);
  });

  describe('archives', () => {
    it('reports damaged and encrypted archives without losing the other sources', async () => {
      const result = await run(
        pickFiles({
          'good.zip': zipOf({ 'S/IM1': slice(`${STUDY_1}.1`, 1) }),
          'broken.zip': zipOf({ IM1: slice(`${STUDY_1}.2`, 1) }).slice(0, 60),
          'locked.zip': buildZip([{ name: 'IM1', data: slice(`${STUDY_1}.3`, 1), flags: 1 }]),
        })
      );

      expect(result.instanceCount).toBe(1);
      expect(result.failedArchives.map((a) => a.path)).toEqual(['broken.zip', 'locked.zip']);
      expect(result.failedArchives[1].message).toMatch(/encrypted/i);
    });

    it('rejects an archive whose end record omits entries, never a partial Series', async () => {
      const zip = buildZip([
        { name: 'S/IM1', data: slice(`${STUDY_1}.1`, 1) },
        { name: 'S/IM2', data: slice(`${STUDY_1}.1`, 2) },
      ]);
      // Only the entry counts of the end record say 1 (directory intact).
      const end = new DataView(zip.buffer, zip.byteOffset + zip.length - 22, 22);
      end.setUint16(8, 1, true);
      end.setUint16(10, 1, true);

      const result = await run(pickFiles({ 'loose-IM': slice(`${STUDY_2}.1`, 1), 'study.zip': zip }));

      expect(result.failedArchives.map((a) => a.path)).toEqual(['study.zip']);
      expect(result.failedArchives[0].message).toMatch(/more records than declared/);
      expect(summary(result).series).toEqual([
        { study: STUDY_2, series: `${STUDY_2}.1`, instances: [`${STUDY_2}.1.1`] },
      ]);
      expect(result.incompleteSources).toEqual([{ source: '', count: 1 }]);
    });

    describe('no partial Series from an archive with an unreadable entry', () => {
      const valid = (n: number) => ({ name: `S/IM${n}`, data: slice(`${STUDY_1}.1`, n) });

      it.each([
        ['a damaged entry (CRC-32)', { name: 'S/IM9', data: slice(`${STUDY_1}.1`, 9), crc: 42 }, /An entry of this archive is damaged \(size or CRC-32/],
        ['an archive inside the archive', { name: 'S/inner.zip', data: zipOf({ IM1: slice(`${STUDY_2}.1`, 1) }) }, /archive inside the archive/],
        ['an unsupported compression method', { name: 'S/IM9', data: slice(`${STUDY_1}.1`, 9), method: 12 }, /unsupported compression/],
        ['a damaged DICOM file', { name: 'S/IM9', data: new Uint8Array([...syntheticDicom().slice(0, 140), 0xff, 0xff, 0xff]) }, /damaged DICOM file/],
        ['DICOM without UIDs', { name: 'S/IM9', data: syntheticDicom({ seriesUid: '' }) }, /without Study, Series or SOP Instance UID/],
      ] as const)('rejects the archive for %s after valid entries', async (_label, bad, message) => {
        const onProgress = jest.fn();
        const result = await run(
          pickFiles({
            'loose-IM': slice(`${STUDY_2}.1`, 1),
            'study.zip': buildZip([valid(1), valid(2), bad as ZipFixtureEntry]),
          }),
          { onProgress }
        );

        expect(result.failedArchives.map((a) => a.path)).toEqual(['study.zip']);
        expect(result.failedArchives[0].message).toMatch(message);
        expect(result.failedArchives[0].message).toMatch(/Nothing from this archive was imported/);
        // Nothing of the archive is selectable or counted…
        expect(summary(result).series).toEqual([
          { study: STUDY_2, series: `${STUDY_2}.1`, instances: [`${STUDY_2}.1.1`] },
        ]);
        expect(result.skipped).toEqual([]);
        expect(onProgress).toHaveBeenLastCalledWith(
          expect.objectContaining({ instancesFound: 1, skippedCount: 0 })
        );
        // …and the files chosen with it are marked as possibly incomplete.
        expect(result.incompleteSources).toEqual([{ source: '', count: 1 }]);
        expect(result.series[0].warnings).toEqual(['source-incomplete']);
      });

      it('rejects an archive with an entry above the size limit before extracting', async () => {
        const result = await run(
          pickFiles({ 'study.zip': buildZip([valid(1), { name: 'S/big', data: new Uint8Array(2048) }]) }),
          { limits: { maxFileBytes: 1024 } }
        );
        expect(result.failedArchives[0].message).toMatch(/An entry of this archive is above the size limit/);
        expect(result.series).toEqual([]);
      });

      it('keeps an archive whose other files are no images (README, report)', async () => {
        const result = await run(
          pickFiles({
            'study.zip': buildZip([
              valid(1),
              { name: 'README.txt', data: text('Synthetic.\n') },
              {
                name: 'S/report',
                data: syntheticDicom({ sopClassUid: BASIC_TEXT_SR, pixels: false, sopUid: '2.25.9' }),
              },
              { name: '__MACOSX/S/._IM1', data: text('meta') },
            ]),
          })
        );
        expect(result.failedArchives).toEqual([]);
        expect(result.instanceCount).toBe(1);
        expect(result.incompleteSources).toEqual([]);
        expect(result.series[0].warnings).toEqual([]);
      });
    });

    describe('folders with unreadable DICOM candidates', () => {
      it('marks the Series of that folder only, without assigning the file to one', async () => {
        const result = await run(
          dropFolderTrees({
            A: {
              'S1/IM1': slice(`${STUDY_1}.1`, 1),
              'S1/IM2': slice(`${STUDY_1}.1`, 2),
              'S2/IM1': slice(`${STUDY_1}.2`, 1),
              'S1/broken': new Uint8Array([...syntheticDicom().slice(0, 140), 0xff, 0xff]),
            },
            B: { 'IM1': slice(`${STUDY_2}.1`, 1) },
          })
        );

        expect(result.incompleteSources).toEqual([{ source: 'A', count: 1 }]);
        const warnings = Object.fromEntries(
          result.series.map((s) => [s.seriesInstanceUid, s.warnings])
        );
        // Both Series of A: the damaged file could belong to either.
        expect(warnings).toEqual({
          [`${STUDY_1}.1`]: ['source-incomplete'],
          [`${STUDY_1}.2`]: ['source-incomplete'],
          [`${STUDY_2}.1`]: [],
        });
        // The skipped file is listed, never moved into a Series.
        expect(result.skipped).toEqual([{ path: 'A/S1/broken', reason: 'invalid-dicom' }]);
        expect(result.instanceCount).toBe(4);
      });

      it('marks the Series of a folder that holds a rejected archive', async () => {
        const result = await run(
          dropFolderTrees({
            A: {
              'IM1': slice(`${STUDY_1}.1`, 1),
              'rest.zip': buildZip([
                { name: 'IM2', data: slice(`${STUDY_1}.1`, 2), crc: 42 },
              ]),
            },
          })
        );
        expect(result.failedArchives.map((a) => a.path)).toEqual(['A/rest.zip']);
        expect(result.series[0].warnings).toEqual(['source-incomplete']);
      });

      it('does not flag large pictures or other non-DICOM files', async () => {
        const result = await run(
          pickFolder({ 'S/IM1': slice(`${STUDY_1}.1`, 1), 'S/notes.txt': text('notes') })
        );
        expect(result.incompleteSources).toEqual([]);
        expect(result.series[0].warnings).toEqual([]);
      });
    });

    it('fails safely on a ZIP bomb (lying sizes) inside an archive', async () => {
      const result = await run(
        pickFiles({
          'bomb.zip': buildZip([{ name: 'zeros', data: new Uint8Array(4 * 1024 * 1024), declaredSize: 10 }]),
        })
      );
      expect(result.series).toEqual([]);
      expect(result.failedArchives[0].message).toMatch(/ZIP bomb/);
    });

    describe('all or nothing per archive', () => {
      const valid = (n: number) => ({ name: `S/IM${n}`, data: slice(`${STUDY_1}.1`, n) });
      /** Valid entries, then one that expands beyond its declared size. */
      const unsafeAfterValid = () =>
        buildZip([
          valid(1),
          valid(2),
          valid(3),
          { name: 'S/zeros', data: new Uint8Array(2 * 1024 * 1024), declaredSize: 100 },
        ]);

      it('keeps nothing of an archive that turns out unsafe after valid entries', async () => {
        const onProgress = jest.fn();
        const result = await run(pickFiles({ 'study.zip': unsafeAfterValid() }), { onProgress });

        expect(result.failedArchives.map((a) => a.path)).toEqual(['study.zip']);
        expect(result.failedArchives[0].message).toMatch(/ZIP bomb/);
        // No selectable (partial) Series from the rejected archive.
        expect(result.series).toEqual([]);
        expect(result.instanceCount).toBe(0);
        expect(result.skipped).toEqual([]);
        expect(onProgress).toHaveBeenLastCalledWith(
          expect.objectContaining({ instancesFound: 0, skippedCount: 0 })
        );
      });

      it('keeps nothing of an archive damaged after partially successful extraction', async () => {
        const bytes = buildZip([valid(1), valid(2), valid(3)]);
        // Break the third entry's local header signature (found after two
        // entries were extracted and accepted).
        const third = localHeaderOffsets(bytes)[2];
        new DataView(bytes.buffer).setUint32(third, 0, true);

        const result = await run(pickFiles({ 'study.zip': bytes }));
        expect(result.failedArchives[0].message).toMatch(/damaged/);
        expect(result.series).toEqual([]);
      });

      it('keeps other sources intact and imports a rolled-back UID from another archive', async () => {
        const result = await run(
          pickFiles({
            'a-folder-file': slice(`${STUDY_2}.1`, 1),
            'b-bad.zip': unsafeAfterValid(),
            'c-good.zip': buildZip([valid(1), valid(2)]),
          })
        );
        expect(result.failedArchives.map((a) => a.path)).toEqual(['b-bad.zip']);
        expect(summary(result).series).toEqual([
          { study: STUDY_1, series: `${STUDY_1}.1`, instances: [`${STUDY_1}.1.1`, `${STUDY_1}.1.2`] },
          { study: STUDY_2, series: `${STUDY_2}.1`, instances: [`${STUDY_2}.1.1`] },
        ]);
        // Not reported as duplicates of the rejected archive's copies.
        expect(result.skipped).toEqual([]);
        expect(result.series[0].instances.every((i) => i.path.startsWith('c-good.zip/'))).toBe(true);
      });

      it('keeps instances found before a failed archive, deduplicated as usual', async () => {
        const result = await run(
          pickFiles({
            'a.zip': buildZip([valid(1)]),
            'b.zip': buildZip([valid(1), { name: 'x', data: syntheticDicom(), flags: 1 }]),
          })
        );
        expect(result.instanceCount).toBe(1);
        expect(result.series[0].instances[0].path).toBe('a.zip/S/IM1');
        expect(result.failedArchives.map((a) => a.path)).toEqual(['b.zip']);
      });
    });

    it('stops the import when archives expand beyond the memory limit', async () => {
      const error = await failureOf(
        run(pickFiles({ 'a.zip': zipOf(exampleStudy()) }), {
          limits: { maxExtractedBytes: 1000 },
        })
      );
      expect(error.code).toBe('LIMIT_EXCEEDED');
    });
  });

  it('stops with a clear message above the file count limit', async () => {
    const error = await failureOf(run(pickFolder(exampleStudy()), { limits: { maxFiles: 5 } }));
    expect(error.code).toBe('LIMIT_EXCEEDED');
    expect(error.message).toMatch(/More than 5 files/);
  });

  it('can be cancelled while running', async () => {
    const controller = new AbortController();
    const promise = run(dropFolder(exampleStudy()), {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.filesFound === 2) controller.abort();
      },
    });
    expect((await failureOf(promise)).code).toBe('CANCELLED');
  });

  it('reports progress', async () => {
    const onProgress = jest.fn();
    await run(pickFolder(exampleStudy()), { onProgress });
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ filesFound: 9, filesChecked: 9, instancesFound: 7, skippedCount: 2 })
    );
  });

  it('never sends anything over the network', async () => {
    const fetchSpy = jest.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const openSpy = jest.spyOn(XMLHttpRequest.prototype, 'open');
    const beaconSpy = jest.fn();
    Object.defineProperty(navigator, 'sendBeacon', { value: beaconSpy, configurable: true });
    try {
      const study = exampleStudy();
      await run(dropFolder(study));
      await run(pickFiles({ 'study.zip': zipOf(study) }));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
      expect(beaconSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      openSpy.mockRestore();
    }
  });

  it('handles a large synthetic study (1,000 slices, folder and ZIP)', async () => {
    const files: Record<string, Uint8Array> = {};
    for (let n = 1; n <= 1000; n++) {
      files[`Big/Series_001/${String(n).padStart(6, '0')}`] = slice(`${STUDY_1}.1`, n, {
        rows: 32,
        columns: 32,
      });
    }
    const started = Date.now();
    const fromFolder = await run(pickFolder(files));
    const folderMs = Date.now() - started;
    const fromZip = await run(pickFiles({ 'big.zip': zipOf(files) }));
    const zipMs = Date.now() - started - folderMs;

    expect(fromFolder.series[0].instances).toHaveLength(1000);
    expect(fromZip.series[0].instances).toHaveLength(1000);
    // Generous bounds (jsdom is much slower than a browser): no blow-up.
    expect(folderMs).toBeLessThan(30_000);
    expect(zipMs).toBeLessThan(30_000);
  }, 60_000);
});

describe('importLocalDicom: TAR-family archives', () => {
  const study = tarStudy();
  const tar = tarOf(study);
  /** Every server-supported TAR-family name with matching content. */
  const tarFamily: [string, Uint8Array][] = [
    ['study.tar', tar],
    ['study.tar.gz', gzipSync(tar)],
    ['study.tgz', gzipSync(tar)],
    ['study.tar.bz2', TAR_STUDY_BZ2],
    ['study.tbz2', TAR_STUDY_BZ2],
    ['study.tar.xz', TAR_STUDY_XZ],
    ['study.txz', TAR_STUDY_XZ],
  ];
  const seriesOf = (series: string, count: number) => ({
    study: series.startsWith(TAR_STUDY_2) ? TAR_STUDY_2 : TAR_STUDY_1,
    series,
    instances: Array.from({ length: count }, (_, i) => `${series}.${i + 1}`),
  });
  const expectedTar = {
    series: [
      seriesOf(`${TAR_STUDY_1}.1`, 3),
      seriesOf(`${TAR_STUDY_1}.2`, 2),
      seriesOf(`${TAR_STUDY_2}.1`, 2),
    ],
    skipped: ['dicomdir', 'not-dicom'],
  };
  const valid = (n: number): TarFixtureEntry => ({
    name: `S/IM${n}`,
    data: tarSlice(`${TAR_STUDY_1}.1`, n),
  });

  it('finds the same Series in a folder and a ZIP (the reference)', async () => {
    expect(summary(await run(pickFolder(study)))).toEqual(expectedTar);
    expect(summary(await run(pickFiles({ 'study.zip': zipOf(study) })))).toEqual(expectedTar);
  });

  it.each(tarFamily)(
    '%s: same Series, counts and original bytes as folder and ZIP (nested, extensionless)',
    async (name, bytes) => {
      const result = await run(pickFiles({ [name]: bytes }));
      const fromFolder = await run(pickFolder(study));
      const fromZip = await run(pickFiles({ 'study.zip': zipOf(study) }));

      expect(summary(result)).toEqual(expectedTar);
      // The archive file itself counts as one file found (as a ZIP does).
      expect(result.fileCount).toBe(fromZip.fileCount);
      expect(result.fileCount).toBe(fromFolder.fileCount + 1);
      expect(result.instanceCount).toBe(fromFolder.instanceCount);
      expect(result.skipped.map((s) => s.reason)).toEqual(fromZip.skipped.map((s) => s.reason));
      expect(result.failedArchives).toEqual([]);
      expect(result.incompleteSources).toEqual([]);
      for (const instance of result.series.flatMap((s) => s.instances)) {
        const source = instance.path.slice(name.length + 1);
        expect(await readBlobBytes(instance.file)).toEqual(study[source]);
      }
      expect(result.series[0].instances[2].path).toBe(
        `${name}/TarStudy/Study_001/Series_001/more/IM000003`
      );
    }
  );

  it('groups by DICOM UIDs, never by TAR folder names', async () => {
    const result = await run(
      pickFiles({
        'mixed.tar': buildTar([
          { name: 'Mixed/IM1', data: tarSlice(`${TAR_STUDY_1}.1`, 1) },
          { name: 'Mixed/IM2', data: tarSlice(`${TAR_STUDY_1}.2`, 1) },
          { name: 'Other/IM1', data: tarSlice(`${TAR_STUDY_1}.1`, 2) },
        ]),
      })
    );
    expect(summary(result).series.map((s) => s.instances)).toEqual([
      [`${TAR_STUDY_1}.1.1`, `${TAR_STUDY_1}.1.2`],
      [`${TAR_STUDY_1}.2.1`],
    ]);
  });

  describe('name and content must agree', () => {
    it.each([
      ['study.tar.gz', tar, /does not match the archive content/],
      ['study.tar', gzipSync(tar), /does not match the archive content/],
      ['study.tgz', TAR_STUDY_BZ2, /does not match the archive content/],
      ['study.tar.xz', zipOf(study), /does not match the archive content/],
      ['study.tar.bz2', text('not an archive'), /not a valid \.tar\.bz2 archive/],
      ['study.tar', buildTar([{ name: 'IM1', badChecksum: true }]), /not a valid \.tar archive/],
      ['study.tar', new Uint8Array(0), /not a valid \.tar archive/],
    ])('rejects %s with other content, keeping the other files', async (name, bytes, message) => {
      const result = await run(pickFiles({ 'loose-IM': slice(`${STUDY_2}.1`, 1), [name]: bytes }));
      expect(result.failedArchives.map((a) => a.path)).toEqual([name]);
      expect(result.failedArchives[0].message).toMatch(message);
      expect(result.instanceCount).toBe(1);
      expect(result.incompleteSources).toEqual([{ source: '', count: 1 }]);
    });

    it.each([
      ['study.gz', gzipSync(tar)],
      ['IM000001', tar],
      ['study.bz2', TAR_STUDY_BZ2],
      ['study.zip', tar],
    ])('does not open %s (archive content, no TAR-family name)', async (name, bytes) => {
      const result = await run(pickFiles({ [name]: bytes }));
      expect(result.series).toEqual([]);
      expect(result.failedArchives[0].message).toMatch(
        /does not end in a supported archive extension/
      );
      expect(result.failedArchives[0].message).toMatch(/\.tar\.gz, \.tgz/);
    });
  });

  describe('all or nothing per archive', () => {
    const damagedDicom = new Uint8Array([...syntheticDicom().slice(0, 140), 0xff, 0xff, 0xff]);
    const cases: [string, TarFixtureEntry, RegExp][] = [
      ['a symbolic link', { name: 'S/IM9', type: '2', linkName: 'IM1' }, /is a link or special file/],
      ['a hard link', { name: 'S/IM9', type: '1', linkName: 'S/IM1' }, /is a link or special file/],
      ['a FIFO', { name: 'S/IM9', type: '6' }, /is a link or special file/],
      [
        'a nested ZIP',
        { name: 'S/inner.zip', data: zipOf({ IM1: slice(`${STUDY_2}.1`, 1) }) },
        /archive inside the archive/,
      ],
      ['a nested TAR', { name: 'S/inner', data: buildTar([valid(5)]) }, /archive inside the archive/],
      [
        'a nested tar.gz',
        { name: 'S/inner.tgz', data: gzipSync(buildTar([valid(5)])) },
        /archive inside the archive/,
      ],
      ['a damaged DICOM file', { name: 'S/IM9', data: damagedDicom }, /damaged DICOM file/],
      [
        'DICOM without UIDs',
        { name: 'S/IM9', data: syntheticDicom({ seriesUid: '' }) },
        /without Study, Series or SOP Instance UID/,
      ],
      [
        'a duplicate path',
        { name: 'S/./IM1', data: tarSlice(`${TAR_STUDY_1}.1`, 9) },
        /appears more than once/,
      ],
      [
        'an unsafe path',
        { name: '../../IM9', data: tarSlice(`${TAR_STUDY_1}.1`, 9) },
        /rejected as unsafe \(path traversal\)/,
      ],
      [
        'a PAX path traversal',
        { name: 'S/IM9', pax: { path: 'S/../../IM9' } },
        /rejected as unsafe \(path traversal\)/,
      ],
      ['an invalid header checksum', { name: 'S/IM9', badChecksum: true }, /invalid header checksum/],
    ];
    const formats: [string, (bytes: Uint8Array) => Uint8Array][] = [
      ['study.tar', (bytes) => bytes],
      ['study.tar.gz', (bytes) => gzipSync(bytes)],
    ];

    describe.each(formats)('%s', (name, encode) => {
      it.each(cases)('rejects the archive for %s after valid entries', async (_label, bad, message) => {
        const onProgress = jest.fn();
        const result = await run(
          pickFiles({
            'loose-IM': slice(`${STUDY_2}.1`, 1),
            [name]: encode(buildTar([valid(1), valid(2), bad, valid(3)])),
          }),
          { onProgress }
        );

        expect(result.failedArchives.map((a) => a.path)).toEqual([name]);
        expect(result.failedArchives[0].message).toMatch(message);
        // Nothing of the archive is selectable or counted…
        expect(summary(result).series).toEqual([
          { study: STUDY_2, series: `${STUDY_2}.1`, instances: [`${STUDY_2}.1.1`] },
        ]);
        expect(result.skipped).toEqual([]);
        expect(onProgress).toHaveBeenLastCalledWith(
          expect.objectContaining({ instancesFound: 1, skippedCount: 0, archive: undefined })
        );
        // …and the files chosen with it are marked as possibly incomplete.
        expect(result.incompleteSources).toEqual([{ source: '', count: 1 }]);
        expect(result.series[0].warnings).toEqual(['source-incomplete']);
      });
    });

    it('rejects a compressed archive that ends early, after valid entries', async () => {
      const xz = TAR_STUDY_XZ.slice(0, TAR_STUDY_XZ.length - 20);
      const result = await run(pickFiles({ 'study.tar.xz': xz }));
      expect(result.failedArchives[0].message).toMatch(/damaged or incomplete/);
      expect(result.series).toEqual([]);
      expect(result.skipped).toEqual([]);
    });

    it('rejects a TAR without its end-of-archive marker (truncated at an entry)', async () => {
      const bytes = buildTar([valid(1), valid(2)], { endBlocks: 0 });
      const result = await run(pickFiles({ 'study.tar': bytes }));
      expect(result.failedArchives[0].message).toMatch(/no end-of-archive marker/);
      expect(result.series).toEqual([]);
    });

    it('gives back the memory of a rejected archive and its UIDs to the next one', async () => {
      const entries = [valid(1), valid(2), valid(3)];
      const size = entries.reduce((n, e) => n + (e.data?.length ?? 0), 0);
      const link: TarFixtureEntry = { name: 'S/link', type: '2', linkName: 'x' };
      const result = await run(
        pickFiles({
          'a-bad.tar.gz': gzipSync(buildTar([...entries, link])),
          'b-good.tar.gz': gzipSync(buildTar(entries)),
        }),
        { limits: { maxExtractedBytes: size } }
      );
      expect(result.failedArchives.map((a) => a.path)).toEqual(['a-bad.tar.gz']);
      expect(result.instanceCount).toBe(3);
      // Not reported as duplicates of the rejected archive's copies.
      expect(result.skipped).toEqual([]);
      expect(result.series[0].instances.every((i) => i.path.startsWith('b-good.tar.gz/'))).toBe(
        true
      );
    });

    it('keeps an archive whose other files are no images or system files', async () => {
      const report = syntheticDicom({ sopClassUid: BASIC_TEXT_SR, pixels: false, sopUid: '2.25.9' });
      const result = await run(
        pickFiles({
          'study.tar': buildTar([
            valid(1),
            { name: 'README.txt', data: text('Synthetic.\n') },
            { name: 'S/report', data: report },
            { name: '__MACOSX/S/._IM1', data: text('meta') },
            { name: 'S/', type: '5' },
          ]),
        })
      );
      expect(result.failedArchives).toEqual([]);
      expect(result.instanceCount).toBe(1);
      expect(result.series[0].warnings).toEqual([]);
    });

    describe('links and special files are rejected whatever their name', () => {
      const named: [string, TarFixtureEntry][] = [
        [
          'a symbolic link named like macOS metadata',
          { name: '__MACOSX/S/._IM1', type: '2', linkName: 'x' },
        ],
        ['a hard link named .DS_Store', { name: 'S/.DS_Store', type: '1', linkName: 'S/IM1' }],
        ['a FIFO named DICOMDIR', { name: 'DICOMDIR', type: '6' }],
        ['a character device named Thumbs.db', { name: 'S/Thumbs.db', type: '3' }],
        ['a block device named DICOMDIR', { name: 'S/DICOMDIR', type: '4' }],
      ];

      describe.each(formats)('%s', (name, encode) => {
        it.each(named)('rejects the archive for %s', async (_label, bad) => {
          const result = await run(
            pickFiles({
              'loose-IM': slice(`${STUDY_2}.1`, 1),
              [name]: encode(buildTar([valid(1), bad, valid(2)])),
            })
          );
          expect(result.failedArchives.map((a) => a.path)).toEqual([name]);
          expect(result.failedArchives[0].message).toMatch(/is a link or special file/);
          expect(result.instanceCount).toBe(1);
          expect(result.skipped).toEqual([]);
          expect(result.series[0].warnings).toEqual(['source-incomplete']);
        });
      });

      it.each([
        [
          'a symbolic link named like macOS metadata',
          { name: '__MACOSX/S/._IM1', data: text('x'), unixMode: 0o120777 },
        ],
        [
          'a symbolic link named DICOMDIR',
          { name: 'S/DICOMDIR', data: text('IM1'), unixMode: 0o120777 },
        ],
        ['a FIFO named .DS_Store', { name: '.DS_Store', unixMode: 0o010644 }],
        [
          'an unsupported compression method on .DS_Store',
          { name: '.DS_Store', data: text('x'), method: 12 },
        ],
        // Named like a directory (trailing separator): the Unix type decides.
        [
          'a symbolic link with a trailing /',
          { name: 'S/IM9/', data: text('IM1'), unixMode: 0o120777 },
        ],
        [
          'a symbolic link under __MACOSX with a trailing /',
          { name: '__MACOSX/S/IM9/', data: text('IM1'), unixMode: 0o120777 },
        ],
        ['a FIFO with a trailing /', { name: 'S/IM9/', unixMode: 0o010644 }],
        ['a block device with a trailing \\', { name: 'S/IM9\\', unixMode: 0o060644 }],
        ['a directory entry holding data', { name: 'S/IM9/', data: slice(`${STUDY_1}.1`, 9) }],
      ] as [string, ZipFixtureEntry][])('rejects a ZIP for %s', async (_label, bad) => {
        const result = await run(
          pickFiles({
            'loose-IM': slice(`${STUDY_2}.1`, 1),
            'study.zip': buildZip([valid(1), bad, valid(2)]),
          })
        );
        expect(result.failedArchives.map((a) => a.path)).toEqual(['study.zip']);
        expect(result.failedArchives[0].message).toMatch(/is a link or special file/);
        // No partial Series from the rejected archive.
        expect(summary(result).series).toEqual([
          { study: STUDY_2, series: `${STUDY_2}.1`, instances: [`${STUDY_2}.1.1`] },
        ]);
        expect(result.skipped).toEqual([]);
        expect(result.series[0].warnings).toEqual(['source-incomplete']);
      });

      describe('a directory entry declaring no data but carrying a DICOM image', () => {
        const hidden = slice(`${STUDY_1}.1`, 9);
        it.each([
          ['stored, trailing /', { name: 'S/IM9/', method: 0 }, /stored entry sizes differ/],
          ['stored, trailing \\', { name: 'S/IM9\\', method: 0 }, /stored entry sizes differ/],
          [
            'stored, Unix directory type',
            { name: 'S/IM9', method: 0, unixMode: 0o040755 },
            /stored entry sizes differ/,
          ],
          ['deflated, trailing /', { name: 'S/IM9/' }, /is a link or special file/],
          ['deflated, trailing \\', { name: 'S/IM9\\' }, /is a link or special file/],
          [
            'deflated, Unix directory type',
            { name: 'S/IM9', unixMode: 0o040755 },
            /is a link or special file/,
          ],
        ] as [string, ZipFixtureEntry, RegExp][])(
          'rejects the ZIP (%s)',
          async (_label, dir, message) => {
            const result = await run(
              pickFiles({
                'loose-IM': slice(`${STUDY_2}.1`, 1),
                'study.zip': buildZip([
                  valid(1),
                  { ...dir, data: hidden, declaredSize: 0 },
                  valid(2),
                ]),
              })
            );
            expect(result.failedArchives.map((a) => a.path)).toEqual(['study.zip']);
            expect(result.failedArchives[0].message).toMatch(message);
            // No partial Series from the rejected archive.
            expect(summary(result).series).toEqual([
              { study: STUDY_2, series: `${STUDY_2}.1`, instances: [`${STUDY_2}.1.1`] },
            ]);
            expect(result.skipped).toEqual([]);
            expect(result.incompleteSources).toEqual([{ source: '', count: 1 }]);
            expect(result.series[0].warnings).toEqual(['source-incomplete']);
          }
        );
      });

      it('still opens a ZIP with ordinary directory entries', async () => {
        const result = await run(
          pickFiles({
            'study.zip': buildZip([
              { name: 'S/' },
              { name: 'S/sub/', unixMode: 0o040755 },
              { name: 'T', unixMode: 0o040755 },
              { name: '__MACOSX/', method: 0 },
              valid(1),
              { ...valid(2), name: 'S/sub/IM2' },
            ]),
          })
        );
        expect(result.failedArchives).toEqual([]);
        expect(result.instanceCount).toBe(2);
        expect(result.skipped).toEqual([]);
        expect(result.series[0].warnings).toEqual([]);
      });

      it('still skips ordinary system files and DICOMDIR that cannot be read', async () => {
        const dicomdir = syntheticDicom({ sopClassUid: MEDIA_STORAGE_DIRECTORY, pixels: false });
        const entries: TarFixtureEntry[] = [
          valid(1),
          { name: 'S/.DS_Store', data: new Uint8Array(2048) },
          { name: 'DICOMDIR', data: dicomdir },
          { name: 'DICOMDIR', data: dicomdir },
          { name: '__MACOSX/S/._IM1', data: text('meta') },
        ];
        for (const [name, encode] of formats) {
          const result = await run(pickFiles({ [name]: encode(buildTar(entries)) }), {
            limits: { maxFileBytes: 1024 },
          });
          expect(result.failedArchives).toEqual([]);
          expect(result.instanceCount).toBe(1);
          expect(result.skipped.map((s) => s.reason)).toEqual([
            'too-large',
            'dicomdir',
            'duplicate-path',
            'system-file',
          ]);
          expect(result.series[0].warnings).toEqual([]);
        }
      });
    });
  });

  describe('failed archives never name a file or entry', () => {
    // Synthetic names shaped like patient identifiers.
    const phi = 'DOE^JANE_MRN-0042';
    const PHI = /DOE|JANE|MRN|0042/;
    const entry = (data: Uint8Array) => ({ name: `${phi}/${phi}_IM9`, data });
    const damagedDicom = new Uint8Array([...syntheticDicom().slice(0, 140), 0xff, 0xff, 0xff]);
    const tarCases: [string, TarFixtureEntry][] = [
      ['a symbolic link', { name: `${phi}/${phi}_IM9`, type: '2', linkName: `${phi}/IM1` }],
      ['a nested archive', entry(buildTar([valid(5)]))],
      ['a damaged DICOM file', entry(damagedDicom)],
      ['DICOM without UIDs', entry(syntheticDicom({ seriesUid: '' }))],
      ['a duplicate path', { name: 'S/./IM1', data: tarSlice(`${TAR_STUDY_1}.1`, 9) }],
      ['an unsafe path', { name: `../${phi}/IM9`, data: tarSlice(`${TAR_STUDY_1}.1`, 9) }],
      ['a PAX path traversal', { name: 'S/IM9', pax: { path: `${phi}/../../${phi}` } }],
      ['a control character', { name: `${phi}\u0007/IM9`, data: tarSlice(`${TAR_STUDY_1}.1`, 9) }],
    ];
    const zipCases: [string, ZipFixtureEntry][] = [
      ['a damaged entry (CRC-32)', { ...entry(slice(`${STUDY_1}.1`, 9)), crc: 42 }],
      ['an entry above the size limit', entry(new Uint8Array(2 * 1024 * 1024))],
      ['an unsupported compression method', { ...entry(slice(`${STUDY_1}.1`, 9)), method: 12 }],
      ['a symbolic link', { ...entry(text('IM1')), unixMode: 0o120777 }],
      [
        'a symbolic link named like a directory',
        { name: `${phi}/${phi}_IM9/`, data: text('IM1'), unixMode: 0o120777 },
      ],
      ['a FIFO named like a directory', { name: `__MACOSX/${phi}/`, unixMode: 0o010644 }],
      ['a ZIP bomb', { ...entry(new Uint8Array(2 * 1024 * 1024)), declaredSize: 100 }],
      ['an unsafe path', { name: `../${phi}/IM9`, data: slice(`${STUDY_1}.1`, 9) }],
    ];

    const expectPrivate = (result: LocalImportResult, archiveName: string, format: string) => {
      expect(result.failedArchives).toHaveLength(1);
      const [failed] = result.failedArchives;
      // The path stays internal (incomplete-source flags); the rest is shown.
      expect(failed.path).toBe(archiveName);
      expect(failed).toMatchObject({ index: 1, format });
      expect(failed.message).not.toMatch(PHI);
      expect(failed.message).not.toMatch(/IM9|IM1/);
      expect(result.incompleteSources).toEqual([{ source: '', count: 1 }]);
    };

    describe.each([
      [`${phi}.tar`, 'TAR', (bytes: Uint8Array) => bytes],
      [`${phi}.tar.gz`, 'TAR.GZ', (bytes: Uint8Array) => gzipSync(bytes)],
    ])('%s', (archiveName, format, encode) => {
      it.each(tarCases)('for %s', async (_label, bad) => {
        const result = await run(
          pickFiles({
            'loose-IM': slice(`${STUDY_2}.1`, 1),
            [archiveName]: encode(buildTar([valid(1), bad])),
          })
        );
        expectPrivate(result, archiveName, format);
      });
    });

    it.each(zipCases)(`${phi}.zip: for %s`, async (_label, bad) => {
      const result = await run(
        pickFiles({
          'loose-IM': slice(`${STUDY_2}.1`, 1),
          [`${phi}.zip`]: buildZip([{ name: `${phi}/IM1`, data: slice(`${STUDY_1}.1`, 1) }, bad]),
        }),
        { limits: { maxFileBytes: 1024 * 1024 } }
      );
      expectPrivate(result, `${phi}.zip`, 'ZIP');
    });

    it.each([
      [`${phi}.tar.xz`, tar, 'TAR.XZ'],
      [`${phi}.tar.bz2`, text(phi), 'TAR.BZ2'],
      [`${phi}.gz`, gzipSync(tar), 'GZIP'],
      [phi, tar, 'TAR'],
    ])('%s: for a name that does not match the content', async (archiveName, bytes, format) => {
      const result = await run(
        pickFiles({ 'loose-IM': slice(`${STUDY_2}.1`, 1), [archiveName]: bytes })
      );
      expectPrivate(result, archiveName, format);
    });

    it('numbers archives in the order they are found', async () => {
      const result = await run(
        pickFiles({
          [`a-${phi}.zip`]: buildZip([{ ...entry(slice(`${STUDY_1}.1`, 9)), crc: 42 }]),
          [`b-${phi}.tar.gz`]: gzipSync(tar),
          [`c-${phi}.tar.bz2`]: text('x'),
        })
      );
      expect(result.failedArchives.map(({ index, format }) => ({ index, format }))).toEqual([
        { index: 1, format: 'ZIP' },
        { index: 3, format: 'TAR.BZ2' },
      ]);
    });
  });

  it('rejects a decompression bomb while it decompresses', async () => {
    const result = await run(pickFiles({ 'bomb.tar.xz': ZEROS_XZ }), {
      limits: { ratioCheckMinBytes: 1024 * 1024 },
    });
    expect(result.failedArchives[0].message).toMatch(/possible archive bomb/);
  });

  it('stops the import when compressed TARs need more memory than the limit', async () => {
    const error = await failureOf(
      run(pickFiles({ 'study.tar.gz': gzipSync(tar) }), { limits: { maxExtractedBytes: 1000 } })
    );
    expect(error.code).toBe('LIMIT_EXCEEDED');
  });

  it('rejects ZIP archives that contain a TAR-family archive', async () => {
    const result = await run(
      pickFiles({ 'study.zip': buildZip([{ name: 'S/inner.tar.xz', data: TAR_STUDY_XZ }]) })
    );
    expect(result.failedArchives[0].message).toMatch(/archive inside the archive/);
  });

  it('reports the archive by its position and format, never its file name', async () => {
    const onProgress = jest.fn();
    await run(pickFiles({ 'Doe^Jane.zip': zipOf(study), 'Doe^Jane.tar.bz2': TAR_STUDY_BZ2 }), {
      onProgress,
    });
    const archives = onProgress.mock.calls.map(([p]) => p.archive).filter(Boolean);
    expect(archives).toContainEqual({ index: 1, format: 'ZIP', percent: expect.any(Number) });
    expect(archives).toContainEqual({ index: 2, format: 'TAR.BZ2', percent: 100 });
    expect(JSON.stringify(archives)).not.toMatch(/Doe/);
  });

  it.each(['study.tar.gz', 'study.tar.bz2', 'study.tar.xz'])(
    'can be cancelled while %s is decompressed, and imported again afterwards',
    async (name) => {
      const bytes = tarFamily.find(([n]) => n === name)?.[1] as Uint8Array;
      const controller = new AbortController();
      const promise = run(pickFiles({ [name]: bytes }), {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.archive) controller.abort();
        },
      });
      expect((await failureOf(promise)).code).toBe('CANCELLED');

      // Retry: the decoder of the cancelled import was released.
      expect(summary(await run(pickFiles({ [name]: bytes })))).toEqual(expectedTar);
    }
  );

  it('never sends anything over the network', async () => {
    const fetchSpy = jest.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const openSpy = jest.spyOn(XMLHttpRequest.prototype, 'open');
    try {
      for (const [name, bytes] of tarFamily) await run(pickFiles({ [name]: bytes }));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      openSpy.mockRestore();
    }
  });

  it('handles a large synthetic TAR (1,000 slices, plain and gzip)', async () => {
    const entries: TarFixtureEntry[] = [];
    for (let n = 1; n <= 1000; n++) {
      entries.push({
        name: `Big/Series_001/${String(n).padStart(6, '0')}`,
        data: slice(`${STUDY_1}.1`, n, { rows: 32, columns: 32 }),
      });
    }
    const big = buildTar(entries);
    const started = Date.now();
    const plain = await run(pickFiles({ 'big.tar': big }));
    const gz = await run(pickFiles({ 'big.tar.gz': gzipSync(big) }));
    expect(plain.series[0].instances).toHaveLength(1000);
    expect(gz.series[0].instances).toHaveLength(1000);
    // Generous bound (jsdom is much slower than a browser): no blow-up.
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 90_000);
});
