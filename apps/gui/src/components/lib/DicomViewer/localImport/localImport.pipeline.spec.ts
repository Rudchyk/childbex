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

  it('reads the whole file when the header is longer than the first bytes read', async () => {
    const result = await run(
      pickFiles({ big: slice(`${STUDY_1}.1`, 1, { privatePaddingBytes: 300 * 1024 }) })
    );
    expect(result.instanceCount).toBe(1);
  });

  it('marks Series whose images differ in size (dwv cannot stack them)', async () => {
    const result = await run(
      pickFolder({
        'S/1': slice(`${STUDY_1}.1`, 1),
        'S/2': slice(`${STUDY_1}.1`, 2, { rows: 8, columns: 8 }),
      })
    );
    expect(result.series[0].hasMixedImageSizes).toBe(true);
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
