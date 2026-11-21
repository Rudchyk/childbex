/**
 * Local import end to end: folders (dropped or chosen) and ZIP archives
 * give the same Series, grouped by DICOM UIDs (not folder names), with
 * the original bytes, and junk or hostile input is reported, not loaded.
 */
import { TextDecoder } from 'util';
import { fakeDataTransfer, type FakeTree } from './__fixtures__/fakeEntries';
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

Object.assign(globalThis, { TextDecoder });

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
      ['Image Type (localizer)', { imageType: 'ORIGINAL\\PRIMARY\\LOCALIZER' }, 'Image Type: ORIGINAL\\PRIMARY\\LOCALIZER'],
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
    it('reports nested archives, damaged entries and damaged archives without losing the rest', async () => {
      const inner = zipOf({ 'IM1': slice(`${STUDY_2}.1`, 1) });
      const result = await run(
        pickFiles({
          'good.zip': buildZip([
            { name: 'S/IM1', data: slice(`${STUDY_1}.1`, 1) },
            { name: 'S/IM2', data: slice(`${STUDY_1}.1`, 2), crc: 42 },
            { name: 'S/inner.zip', data: inner },
          ]),
          'broken.zip': zipOf({ IM1: slice(`${STUDY_1}.2`, 1) }).slice(0, 60),
          'locked.zip': buildZip([{ name: 'IM1', data: slice(`${STUDY_1}.3`, 1), flags: 1 }]),
        })
      );

      expect(result.instanceCount).toBe(1);
      expect(Object.fromEntries(result.skipped.map((s) => [s.path, s.reason]))).toEqual({
        'good.zip/S/IM2': 'corrupt-entry',
        'good.zip/S/inner.zip': 'nested-archive',
      });
      expect(result.failedArchives.map((a) => a.path)).toEqual(['broken.zip', 'locked.zip']);
      expect(result.failedArchives[1].message).toMatch(/encrypted/i);
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
