/**
 * The in-browser ZIP reader validates the central directory before any
 * decompression and stops hostile or damaged archives safely.
 */
import { TextDecoder } from 'util';
import { buildZip, fileOf, syntheticDicom } from './__fixtures__/syntheticDicom';
import { readBlobBytes } from './localImport.files';
import {
  crc32,
  extractZipEntry,
  readZipDirectory,
  ZipEntryDamagedError,
  type ZipEntry,
} from './localImport.zip';
import { defaultLocalImportLimits, LocalImportError } from './localImport.types';

Object.assign(globalThis, { TextDecoder });

const limits = { ...defaultLocalImportLimits };
const zipFile = (bytes: Uint8Array) => fileOf(bytes, 'study.zip');

const expectError = async (promise: Promise<unknown>, code: string, message?: RegExp) => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(LocalImportError);
  expect((error as LocalImportError).code).toBe(code);
  if (message) expect((error as Error).message).toMatch(message);
};

const extract = (archive: File, entry: ZipEntry, remainingBytes = Infinity) =>
  extractZipEntry(archive, entry, { budget: { remainingBytes } });

describe('readZipDirectory / extractZipEntry', () => {
  it('lists nested files (not directories) and extracts the original bytes', async () => {
    const slice1 = syntheticDicom({ sopUid: '2.25.1', instanceNumber: 1 });
    const slice2 = syntheticDicom({ sopUid: '2.25.2', instanceNumber: 2 });
    const archive = zipFile(
      buildZip([
        { name: 'PatientStudy/' },
        { name: 'PatientStudy/Study_001/Series_001/IM000001', data: slice1 },
        { name: 'PatientStudy/Study_001/Series_001/IM000002', data: slice2, method: 0 },
      ])
    );

    const entries = await readZipDirectory(archive, limits);

    expect(entries.map((e) => e.path)).toEqual([
      'PatientStudy/Study_001/Series_001/IM000001',
      'PatientStudy/Study_001/Series_001/IM000002',
    ]);
    expect(await readBlobBytes(await extract(archive, entries[0]))).toEqual(slice1);
    expect(await readBlobBytes(await extract(archive, entries[1]))).toEqual(slice2);
  });

  it('counts only deflated (in-memory) bytes against the budget', async () => {
    const data = syntheticDicom();
    const archive = zipFile(
      buildZip([
        { name: 'a', data },
        { name: 'b', data, method: 0 },
      ])
    );
    const [deflated, stored] = await readZipDirectory(archive, limits);
    const budget = { remainingBytes: 10_000 };

    await extractZipEntry(archive, deflated, { budget });
    await extractZipEntry(archive, stored, { budget });

    expect(budget.remainingBytes).toBe(10_000 - data.length);
  });

  it('decodes UTF-8 names and normalises Windows separators', async () => {
    const archive = zipFile(buildZip([{ name: 'Дослідження\\серія 1\\IM1', data: syntheticDicom() }]));
    const [entry] = await readZipDirectory(archive, limits);
    expect(entry.path).toBe('Дослідження/серія 1/IM1');
  });

  it.each([
    ['path traversal', '../evil'],
    ['nested traversal', 'a/../../evil'],
    ['absolute path', '/etc/passwd'],
    ['drive-letter path', 'C:/Windows/evil'],
    ['control characters', 'a\u0001b'],
  ])('rejects an archive with: %s', async (_label, name) => {
    const archive = zipFile(buildZip([{ name, data: syntheticDicom() }]));
    await expectError(readZipDirectory(archive, limits), 'UNSAFE_ARCHIVE');
  });

  it('rejects encrypted archives with an actionable message', async () => {
    const archive = zipFile(buildZip([{ name: 'IM1', data: syntheticDicom(), flags: 1 }]));
    await expectError(readZipDirectory(archive, limits), 'UNSUPPORTED_ARCHIVE', /encrypted/i);
  });

  it('skips symbolic links, unsupported methods, oversized and duplicate entries', async () => {
    const data = syntheticDicom();
    const big = syntheticDicom({ rows: 64, columns: 64 });
    const archive = zipFile(
      buildZip([
        { name: 'link', data: Uint8Array.from('/etc', (c) => c.charCodeAt(0)), unixMode: 0o120777 },
        { name: 'bzip2', data, method: 12 },
        { name: 'big', data: big },
        { name: 'dup', data },
        { name: 'dup', data },
        { name: 'regular', data, unixMode: 0o100644 },
      ])
    );

    const entries = await readZipDirectory(archive, { ...limits, maxFileBytes: big.length - 1 });

    expect(entries.map((e) => [e.path, e.skipReason])).toEqual([
      ['link', 'unsupported-entry'],
      ['bzip2', 'unsupported-entry'],
      ['big', 'too-large'],
      ['dup', undefined],
      ['dup', 'duplicate-path'],
      ['regular', undefined],
    ]);
  });

  it('rejects entries whose data overlaps (non-recursive ZIP bomb)', async () => {
    const data = syntheticDicom();
    const archive = zipFile(
      buildZip([
        { name: 'a', data },
        { name: 'b', data, localHeaderOfEntry: 0 },
      ])
    );
    await expectError(readZipDirectory(archive, limits), 'UNSAFE_ARCHIVE', /overlapping/);
  });

  it('rejects an extreme overall compression ratio before extracting', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024);
    const archive = zipFile(buildZip([{ name: 'zeros', data: zeros }]));
    await expectError(
      readZipDirectory(archive, { ...limits, ratioCheckMinBytes: 1024 * 1024 }),
      'UNSAFE_ARCHIVE',
      /ZIP bomb/
    );
  });

  it('stops an entry that expands beyond its declared size (lying header)', async () => {
    const zeros = new Uint8Array(2 * 1024 * 1024);
    const archive = zipFile(buildZip([{ name: 'bomb', data: zeros, declaredSize: 1000 }]));
    const [entry] = await readZipDirectory(archive, limits);
    await expectError(extract(archive, entry), 'UNSAFE_ARCHIVE', /declared size/);
  });

  it('stops extraction when the in-memory budget is used up', async () => {
    const archive = zipFile(buildZip([{ name: 'a', data: syntheticDicom({ rows: 64, columns: 64 }) }]));
    const [entry] = await readZipDirectory(archive, limits);
    await expectError(extract(archive, entry, 100), 'LIMIT_EXCEEDED');
  });

  it('reports a damaged entry (CRC mismatch) without failing the archive', async () => {
    const archive = zipFile(buildZip([{ name: 'a', data: syntheticDicom(), crc: 1234 }]));
    const [entry] = await readZipDirectory(archive, limits);
    await expect(extract(archive, entry)).rejects.toBeInstanceOf(ZipEntryDamagedError);
  });

  it('reports invalid deflate data as a damaged entry', async () => {
    const bytes = buildZip([{ name: 'a', data: syntheticDicom() }]);
    // Corrupt the compressed data (after the 30-byte header and name).
    bytes.fill(0xff, 31, 41);
    const archive = zipFile(bytes);
    const [entry] = await readZipDirectory(archive, limits);
    await expect(extract(archive, entry)).rejects.toBeInstanceOf(ZipEntryDamagedError);
  });

  it.each([
    ['is not a ZIP archive', () => syntheticDicom()],
    ['is truncated', () => buildZip([{ name: 'a', data: syntheticDicom() }]).slice(0, 100)],
    [
      'has a damaged central directory',
      () => {
        const bytes = buildZip([{ name: 'a', data: syntheticDicom() }]);
        const view = new DataView(bytes.buffer);
        // The EOCD's central directory offset points past the directory.
        view.setUint32(bytes.length - 6, bytes.length, true);
        return bytes;
      },
    ],
  ])('rejects an archive that %s', async (_label, build) => {
    await expectError(readZipDirectory(zipFile(build()), limits), 'CORRUPT_ARCHIVE');
  });

  it('enforces entry count, archive size and depth limits', async () => {
    const archive = zipFile(
      buildZip([
        { name: 'a/b/c/d', data: syntheticDicom() },
        { name: 'e', data: syntheticDicom() },
      ])
    );
    await expectError(readZipDirectory(archive, { ...limits, maxArchiveEntries: 1 }), 'LIMIT_EXCEEDED');
    await expectError(readZipDirectory(archive, { ...limits, maxArchiveBytes: 10 }), 'LIMIT_EXCEEDED');
    await expectError(readZipDirectory(archive, { ...limits, maxPathDepth: 3 }), 'LIMIT_EXCEEDED');
  });

  it('stops when cancelled', async () => {
    const archive = zipFile(buildZip([{ name: 'a', data: syntheticDicom() }]));
    const controller = new AbortController();
    controller.abort();
    await expectError(readZipDirectory(archive, limits, controller.signal), 'CANCELLED');
  });

  it('keeps large extracted entries intact (output moved into Blob parts)', async () => {
    // 10 MiB of patterned bytes: several 4 MiB parts, compressible.
    const data = new Uint8Array(10 * 1024 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) % 251;
    const archive = zipFile(buildZip([{ name: 'big', data }]));
    const [entry] = await readZipDirectory(archive, limits);
    const extracted = await readBlobBytes(await extract(archive, entry));
    expect(extracted.length).toBe(data.length);
    expect(crc32(0, extracted)).toBe(crc32(0, data));
  });

  it('pauses during long decompression so Cancel takes effect', async () => {
    const files = jest.requireActual('./localImport.files') as typeof import('./localImport.files');
    const controller = new AbortController();
    const pause = jest.spyOn(files, 'yieldToBrowser').mockImplementation(async () => {
      controller.abort();
    });
    try {
      // 40 MiB of zeros: one compressed read, many megabytes of output.
      const zeros = new Uint8Array(40 * 1024 * 1024);
      const archive = zipFile(buildZip([{ name: 'zeros', data: zeros }]));
      const [entry] = await readZipDirectory(archive, limits);
      await expectError(
        extractZipEntry(archive, entry, {
          budget: { remainingBytes: Infinity },
          signal: controller.signal,
        }),
        'CANCELLED'
      );
      expect(pause).toHaveBeenCalledTimes(1);
    } finally {
      pause.mockRestore();
    }
  });

  describe('ZIP64', () => {
    const slice1 = syntheticDicom({ sopUid: '2.25.64.1', instanceNumber: 1 });
    const slice2 = syntheticDicom({ sopUid: '2.25.64.2', instanceNumber: 2 });

    it('reads the ZIP64 end of central directory', async () => {
      const archive = zipFile(
        buildZip(
          [
            { name: 'S/IM1', data: slice1 },
            { name: 'S/IM2', data: slice2, method: 0 },
          ],
          { zip64End: true }
        )
      );
      const entries = await readZipDirectory(archive, limits);
      expect(entries.map((e) => e.path)).toEqual(['S/IM1', 'S/IM2']);
      expect(await readBlobBytes(await extract(archive, entries[0]))).toEqual(slice1);
      expect(await readBlobBytes(await extract(archive, entries[1]))).toEqual(slice2);
    });

    it.each([
      [['uncompressed'] as const],
      [['compressed'] as const],
      [['offset'] as const],
      [['uncompressed', 'offset'] as const],
      [['uncompressed', 'compressed', 'offset'] as const],
    ])('reads entries whose %j fields are in a ZIP64 extra field', async (fields) => {
      const archive = zipFile(
        buildZip(
          [
            { name: 'IM1', data: slice1 },
            { name: 'IM2', data: slice2, zip64: { fields: [...fields] } },
          ],
          { zip64End: true }
        )
      );
      const entries = await readZipDirectory(archive, limits);
      expect(entries[1].uncompressedSize).toBe(slice2.length);
      expect(await readBlobBytes(await extract(archive, entries[1]))).toEqual(slice2);
    });

    it.each([
      [
        'a truncated ZIP64 extra field',
        { fields: ['uncompressed', 'compressed'], extraBytes: 12 },
        /invalid ZIP64 field/,
      ],
      ['a saturated field without ZIP64 extra field', { fields: ['compressed'], omitExtra: true }, /missing ZIP64 field/],
      ['a ZIP64 size beyond 2^53', { fields: ['uncompressed'], override: { uncompressed: 2 ** 60 } }, /out of range/],
      [
        'a ZIP64 offset beyond the archive',
        { fields: ['offset'], override: { offset: 2 ** 40 } },
        /overlapping or misplaced|outside the file/,
      ],
    ] as const)('rejects an entry with %s', async (_label, zip64, message) => {
      const build = () =>
        buildZip([{ name: 'IM1', data: slice1, zip64: { ...zip64, fields: [...zip64.fields] } }]);
      const error = await readZipDirectory(zipFile(build()), limits).then(
        () => undefined,
        (e: unknown) => e as LocalImportError
      );
      expect(error).toBeInstanceOf(LocalImportError);
      expect(['CORRUPT_ARCHIVE', 'UNSAFE_ARCHIVE']).toContain(error?.code);
      expect(error?.message).toMatch(message);
    });

    it('rejects a lying ZIP64 entry size while extracting', async () => {
      const zeros = new Uint8Array(2 * 1024 * 1024);
      const archive = zipFile(
        buildZip([
          { name: 'bomb', data: zeros, zip64: { fields: ['uncompressed'], override: { uncompressed: 1000 } } },
        ])
      );
      const [entry] = await readZipDirectory(archive, limits);
      await expectError(extract(archive, entry), 'UNSAFE_ARCHIVE', /declared size/);
    });

    it.each([
      ['a missing ZIP64 locator', { omitLocator: true }, 'CORRUPT_ARCHIVE', /locator/],
      ['a record offset beyond the archive', { recordOffset: 2 ** 40 }, 'CORRUPT_ARCHIVE', /record offset/],
      ['a record offset that is not a record', { recordOffset: 0 }, 'CORRUPT_ARCHIVE', /ZIP64 record/],
      ['a central directory size beyond the record', { directorySize: 2 ** 40 }, 'CORRUPT_ARCHIVE', /central directory/],
      ['a central directory offset beyond the record', { directoryOffset: 2 ** 40 }, 'CORRUPT_ARCHIVE', /central directory/],
      ['several disks (split archive)', { totalDisks: 2 }, 'UNSUPPORTED_ARCHIVE', /Split/],
    ] as const)('rejects an archive with %s', async (_label, zip64End, code, message) => {
      const archive = zipFile(buildZip([{ name: 'IM1', data: slice1 }], { zip64End }));
      await expectError(readZipDirectory(archive, limits), code, message);
    });
  });

  it('computes standard CRC-32 values', () => {
    expect(crc32(0, Uint8Array.from('123456789', (c) => c.charCodeAt(0)))).toBe(0xcbf43926);
  });
});
