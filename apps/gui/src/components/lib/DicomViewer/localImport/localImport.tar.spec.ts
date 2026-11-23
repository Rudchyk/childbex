/**
 * The in-browser TAR reader: header variants (v7, ustar, GNU, PAX), the
 * effective name validated after every extension, unsupported entry types
 * and damaged or hostile archives.
 */
import { TextDecoder } from 'util';
import { ReadableStream } from 'stream/web';
import { gzipSync } from 'fflate';
import { fileOf, syntheticDicom } from './__fixtures__/syntheticDicom';
import {
  buildTar,
  paxRecord,
  tarEntryBlocks,
  type TarFixtureEntry,
} from './__fixtures__/syntheticTar';
import { TAR_STUDY_XZ, tarOf, tarStudy } from './__fixtures__/tarFixtures';
import { readBlobBytes, sniffContent } from './localImport.files';
import { parsePaxRecords, readTarEntries, tarFormatOf, type TarFormat } from './localImport.tar';
import { defaultLocalImportLimits, LocalImportError } from './localImport.types';

Object.assign(globalThis, {
  TextDecoder,
  ReadableStream: globalThis.ReadableStream ?? ReadableStream,
});

const limits = { ...defaultLocalImportLimits };
const dicom = syntheticDicom();
const bytesOf = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

interface Listed {
  path: string;
  size: number;
  skipReason?: string;
  bytes?: Uint8Array;
}

/** Reads every entry (files without a skip reason are read in full). */
const list = async (
  bytes: Uint8Array,
  options: { format?: TarFormat; limits?: typeof limits; budget?: { remainingBytes: number } } = {}
) => {
  const listed: Listed[] = [];
  const budget = options.budget ?? { remainingBytes: Infinity };
  for await (const entry of readTarEntries(
    fileOf(bytes, 'archive'),
    options.format ?? 'tar',
    options.limits ?? limits
  )) {
    listed.push({
      path: entry.path,
      size: entry.size,
      ...(entry.skipReason
        ? { skipReason: entry.skipReason }
        : { bytes: await readBlobBytes(await entry.read(budget)) }),
    });
  }
  return listed;
};

const listError = async (bytes: Uint8Array, options: Parameters<typeof list>[1] = {}) => {
  const error = await list(bytes, options).then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(LocalImportError);
  return error as LocalImportError;
};

const tarWith = (entries: TarFixtureEntry[]) => buildTar(entries);

describe('tarFormatOf', () => {
  it.each([
    ['study.tar', 'tar'],
    ['study.tar.gz', 'tar.gz'],
    ['study.TGZ', 'tar.gz'],
    ['study.tar.bz2', 'tar.bz2'],
    ['study.tbz2', 'tar.bz2'],
    ['study.tar.xz', 'tar.xz'],
    ['Study.TXZ', 'tar.xz'],
  ])('%s is %s', (name, format) => {
    expect(tarFormatOf(name)).toBe(format);
  });

  it.each(['study.zip', 'study.gz', 'study.tar.gz.txt', '.tar', 'IM000001', 'study.tar.zst'])(
    '%s is not a TAR-family name',
    (name) => {
      expect(tarFormatOf(name)).toBeUndefined();
    }
  );
});

describe('sniffContent (archive signatures)', () => {
  const tar = tarWith([{ name: 'IM1', data: dicom }]);

  it('recognises TAR headers by their checksum (ustar, GNU and v7)', () => {
    expect(sniffContent(tar.subarray(0, 512))).toBe('tar');
    for (const format of ['gnu', 'v7'] as const) {
      expect(sniffContent(tarWith([{ name: 'IM1', data: dicom, format }]).subarray(0, 512))).toBe('tar');
    }
  });

  it('does not take a block with a wrong checksum or zeros for TAR', () => {
    expect(sniffContent(tarWith([{ name: 'IM1', badChecksum: true }]).subarray(0, 512))).toBe('other');
    expect(sniffContent(new Uint8Array(512))).toBe('other');
  });

  it('recognises gzip, bzip2 and xz signatures, and still DICOM', () => {
    expect(sniffContent(gzipSync(tar).subarray(0, 512))).toBe('gzip');
    expect(sniffContent(TAR_STUDY_XZ.subarray(0, 512))).toBe('xz');
    expect(sniffContent(bytesOf('BZh91AY&SY'))).toBe('bzip2');
    expect(sniffContent(bytesOf('BZh is just text'))).toBe('other');
    expect(sniffContent(dicom.subarray(0, 512))).toBe('dicom');
  });
});

describe('readTarEntries', () => {
  it('lists nested files (not directories) with the original bytes', async () => {
    const study = tarStudy();
    const listed = await list(tarOf(study));
    expect(listed.map((e) => e.path)).toEqual(Object.keys(study));
    for (const entry of listed) expect(entry.bytes).toEqual(study[entry.path]);
  });

  it('gives slices of a plain TAR (no copy, no memory budget)', async () => {
    const budget = { remainingBytes: 10 };
    const listed = await list(tarWith([{ name: 'IM1', data: dicom }]), { budget });
    expect(listed[0].bytes).toEqual(dicom);
    expect(budget.remainingBytes).toBe(10);
  });

  it('counts files copied out of a compressed TAR against the budget', async () => {
    const budget = { remainingBytes: 10_000 };
    await list(gzipSync(tarWith([{ name: 'IM1', data: dicom }])), { format: 'tar.gz', budget });
    expect(budget.remainingBytes).toBe(10_000 - dicom.length);
  });

  it('stops when a compressed TAR needs more memory than left', async () => {
    const error = await listError(gzipSync(tarWith([{ name: 'IM1', data: dicom }])), {
      format: 'tar.gz',
      budget: { remainingBytes: 10 },
    });
    expect(error.code).toBe('LIMIT_EXCEEDED');
  });

  describe('header variants', () => {
    it('joins the POSIX ustar prefix and name', async () => {
      const listed = await list(tarWith([{ name: 'IM1', prefix: 'Study/Series', data: dicom }]));
      expect(listed[0].path).toBe('Study/Series/IM1');
    });

    it('ignores the prefix bytes of GNU headers and reads v7 headers', async () => {
      const listed = await list(
        tarWith([
          { name: 'gnu/IM1', format: 'gnu', data: dicom },
          { name: 'v7/IM2', format: 'v7', data: dicom },
          { name: 'v7/folder/', format: 'v7', type: '\0' },
        ])
      );
      expect(listed.map((e) => e.path)).toEqual(['gnu/IM1', 'v7/IM2']);
    });

    it('uses a GNU long name and a PAX path (PAX first)', async () => {
      // Longer than the 100-byte name field, within the depth limit.
      const long = `${'folder_'.repeat(20)}/IM1`;
      const listed = await list(
        tarWith([
          { name: 'truncated', gnuLongName: long, data: dicom },
          { name: 'ignored', pax: { path: 'pax/IM2' }, gnuLongName: 'gnu/IM2', data: dicom },
          { name: 'utf8', pax: { path: 'Дослідження/серія 1/IM3', mtime: '1.5' }, data: dicom },
        ])
      );
      expect(listed.map((e) => e.path)).toEqual([long, 'pax/IM2', 'Дослідження/серія 1/IM3']);
    });

    it('applies a PAX size to the data that follows', async () => {
      const listed = await list(
        tarWith([{ name: 'IM1', pax: { size: String(dicom.length) }, declaredSize: 0, data: dicom }])
      );
      expect(listed[0].bytes).toEqual(dicom);
    });

    it('reads a GNU base-256 size field', async () => {
      const bytes = tarWith([{ name: 'IM1', data: dicom }]);
      bytes.fill(0, 124, 136);
      bytes[124] = 0x80;
      new DataView(bytes.buffer).setUint32(132, dicom.length);
      // Recompute the header checksum.
      bytes.fill(0x20, 148, 156);
      const sum = bytes.subarray(0, 512).reduce((n: number, b: number) => n + b, 0);
      bytes.set(bytesOf(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
      expect((await list(bytes))[0].bytes).toEqual(dicom);
    });

    it('accepts global PAX headers without paths (git archive comments)', async () => {
      const global = tarEntryBlocks({
        name: 'pax_global_header',
        type: 'g',
        data: bytesOf(paxRecord('comment', '0123456789abcdef0123456789abcdef01234567')),
      });
      const bytes = new Uint8Array([...global, ...tarWith([{ name: 'IM1', data: dicom }])]);
      expect((await list(bytes)).map((e) => e.path)).toEqual(['IM1']);
    });

    it('accepts a single end block and zero padding after the end', async () => {
      expect(await list(buildTar([{ name: 'IM1', data: dicom }], { endBlocks: 1 }))).toHaveLength(1);
      expect(await list(buildTar([{ name: 'IM1', data: dicom }], { endBlocks: 20 }))).toHaveLength(1);
    });
  });

  describe('unsafe names (after PAX and GNU extensions)', () => {
    const cases: [string, TarFixtureEntry][] = [
      ['an absolute path', { name: '/etc/IM1' }],
      ['parent traversal', { name: 'a/../../IM1' }],
      ['a drive-letter path', { name: 'C:/Windows/IM1' }],
      ['a UNC path', { name: '\\\\server\\share\\IM1' }],
      ['a control character', { name: 'IM\u00011' }],
      ['a text direction override', { name: 'IM\u202e1mcd.exe' }],
      ['traversal in a PAX path', { name: 'IM1', pax: { path: '../IM1' } }],
      ['an absolute PAX path', { name: 'IM1', pax: { path: '/IM1' } }],
      ['traversal in a GNU long name', { name: 'IM1', gnuLongName: '../../IM1' }],
      ['traversal in a ustar prefix', { name: 'IM1', prefix: '../..' }],
      ['an unsafe link name', { name: '../link', type: '2', linkName: '/etc/passwd' }],
      ['an unsafe directory name', { name: '../dir/', type: '5' }],
    ];
    it.each(cases)('rejects %s', async (_label, entry) => {
      const error = await listError(tarWith([{ data: dicom, ...entry }]));
      expect(error.code).toBe('UNSAFE_ARCHIVE');
      // The unsafe name itself is never part of the message.
      expect(error.message).not.toMatch(/IM1|etc|server|share/);
    });

    it('rejects a NUL character inside a PAX path', async () => {
      const error = await listError(tarWith([{ name: 'IM1', pax: { path: 'a\0../../IM1' } }]));
      expect(error.code).toBe('UNSAFE_ARCHIVE');
    });

    it('stops at the path depth and length limits', async () => {
      const deep = await listError(tarWith([{ name: 'IM1', pax: { path: `${'d/'.repeat(40)}IM1` } }]));
      expect(deep.code).toBe('LIMIT_EXCEEDED');
      const long = await listError(tarWith([{ name: 'IM1', pax: { path: `${'x'.repeat(1100)}` } }]));
      expect(long.code).toBe('LIMIT_EXCEEDED');
    });
  });

  describe('entries that are not read', () => {
    it('marks links, devices and FIFOs as unsupported (never followed)', async () => {
      const listed = await list(
        tarWith([
          { name: 'S/symlink', type: '2', linkName: 'IM1' },
          { name: 'S/hardlink', type: '1', linkName: 'S/IM1' },
          { name: 'S/char', type: '3' },
          { name: 'S/block', type: '4' },
          { name: 'S/fifo', type: '6' },
        ])
      );
      expect(listed.map((e) => e.skipReason)).toEqual(Array(5).fill('unsupported-entry'));
    });

    it('marks duplicate normalised paths', async () => {
      const listed = await list(
        tarWith([
          { name: 'S/IM1', data: dicom },
          { name: 'S/./IM1', data: dicom },
          { name: 'S//IM1', data: dicom },
          { name: 'S\\IM1', data: dicom },
        ])
      );
      expect(listed.map((e) => e.skipReason)).toEqual([
        undefined,
        'duplicate-path',
        'duplicate-path',
        'duplicate-path',
      ]);
    });

    it('marks files above the size limit (and skips their data)', async () => {
      const listed = await list(
        tarWith([
          { name: 'big', data: new Uint8Array(4096) },
          { name: 'IM1', data: dicom },
        ]),
        { limits: { ...limits, maxFileBytes: 1024 } }
      );
      expect(listed.map((e) => e.skipReason)).toEqual(['too-large', undefined]);
      expect(listed[1].bytes).toEqual(dicom);
    });

    it.each([
      ['GNU sparse files', { name: 'IM1', type: 'S' }],
      ['multi-volume archives', { name: 'IM1', type: 'M' }],
      ['unknown entry types', { name: 'IM1', type: 'Z' }],
      ['PAX sparse files', { name: 'IM1', pax: { 'GNU.sparse.major': '1' } }],
      ['non-UTF-8 PAX names', { name: 'IM1', pax: { hdrcharset: 'BINARY' } }],
    ] as [string, TarFixtureEntry][])('rejects %s as unsupported', async (_label, entry) => {
      expect((await listError(tarWith([entry]))).code).toBe('UNSUPPORTED_ARCHIVE');
    });

    it('rejects a global PAX header that sets a path', async () => {
      const global = tarEntryBlocks({ name: 'g', type: 'g', data: bytesOf(paxRecord('path', 'evil/x')) });
      const error = await listError(new Uint8Array([...global, ...tarWith([{ name: 'IM1' }])]));
      expect(error.code).toBe('UNSUPPORTED_ARCHIVE');
    });
  });

  describe('damaged archives', () => {
    const valid = () =>
      tarWith([
        { name: 'S/IM1', data: dicom },
        { name: 'S/IM2', data: dicom },
      ]);

    it('rejects an invalid header checksum', async () => {
      const error = await listError(tarWith([{ name: 'IM1', data: dicom, badChecksum: true }]));
      expect(error.code).toBe('CORRUPT_ARCHIVE');
      expect(error.message).toMatch(/checksum/);
    });

    it.each([
      ['inside a header', 512 * 3 + 100],
      ['inside file data', 512 + 300],
      ['before the end-of-archive marker', valid().length - 1024],
      ['inside the end-of-archive marker', valid().length - 1024 + 100],
    ])('rejects an archive truncated %s', async (_label, length) => {
      expect((await listError(valid().slice(0, length))).code).toBe('CORRUPT_ARCHIVE');
    });

    it('rejects data hidden after the end-of-archive marker', async () => {
      const hidden = buildTar([{ name: 'IM1', data: dicom }], {
        trailing: tarEntryBlocks({ name: 'IM2', data: dicom }),
      });
      const error = await listError(hidden);
      expect(error.message).toMatch(/after the end-of-archive marker/);
    });

    it.each([
      ['an invalid size field', (b: Uint8Array) => b.set(bytesOf('12345678x01\0'), 124)],
      ['a negative base-256 size', (b: Uint8Array) => b.fill(0xff, 124, 136)],
    ])('rejects %s', async (_label, damage) => {
      const bytes = tarWith([{ name: 'IM1', data: dicom }]);
      damage(bytes);
      bytes.fill(0x20, 148, 156);
      const sum = bytes.subarray(0, 512).reduce((n: number, b: number) => n + b, 0);
      bytes.set(bytesOf(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
      expect((await listError(bytes)).code).toBe('CORRUPT_ARCHIVE');
    });

    it('rejects invalid PAX records and sizes', async () => {
      expect(() => parsePaxRecords(bytesOf('99 path=x\n'))).toThrow(LocalImportError);
      expect(() => parsePaxRecords(bytesOf('x path=x\n'))).toThrow(LocalImportError);
      expect(() => parsePaxRecords(bytesOf('9 pathx\n'))).toThrow(LocalImportError);
      expect(parsePaxRecords(bytesOf(`${paxRecord('path', 'x')}\0\0`)).get('path')).toBe('x');
      const size = await listError(tarWith([{ name: 'IM1', pax: { size: '-1' } }]));
      expect(size.code).toBe('CORRUPT_ARCHIVE');
    });

    describe('repeated PAX keys', () => {
      /** A PAX header written verbatim (repeated keys), then the entry. */
      const withPax = (records: string, entry: TarFixtureEntry) =>
        new Uint8Array([
          ...tarEntryBlocks({ name: 'PaxHeader', type: 'x', data: bytesOf(records) }),
          ...tarWith([entry]),
        ]);

      it.each([
        ['path, same value', paxRecord('path', 'S/IM1') + paxRecord('path', 'S/IM1')],
        ['path, conflicting values', paxRecord('path', 'S/IM1') + paxRecord('path', 'S/IM2')],
        ['path, safe then unsafe', paxRecord('path', 'S/IM1') + paxRecord('path', '../IM1')],
        ['size, conflicting values', paxRecord('size', '10') + paxRecord('size', '20')],
        [
          'an ordinary key',
          paxRecord('mtime', '1.5') + paxRecord('path', 'S/IM1') + paxRecord('mtime', '2.5'),
        ],
      ])('rejects a repeated key: %s', async (_label, records) => {
        const error = await listError(withPax(records, { name: 'IM1', data: dicom }));
        expect(error.code).toBe('UNSAFE_ARCHIVE');
        expect(error.message).toMatch(/repeated PAX key/);
        expect(error.message).not.toMatch(/IM1|IM2|path|size|mtime/);
        expect(() => parsePaxRecords(bytesOf(records))).toThrow(/repeated PAX key/);
      });

      it('still reads one PAX header with distinct keys, and GNU long names', async () => {
        const records = paxRecord('path', 'S/IM1') + paxRecord('mtime', '1.5');
        expect(await list(withPax(records, { name: 'ignored', data: dicom }))).toEqual([
          { path: 'S/IM1', size: dicom.length, bytes: dicom },
        ]);
        const long = `${'folder_'.repeat(20)}/IM1`;
        expect(await list(tarWith([{ name: 'short', gnuLongName: long, data: dicom }]))).toEqual([
          { path: long, size: dicom.length, bytes: dicom },
        ]);
      });
    });

    it('rejects extended headers without an entry, or two for one entry', async () => {
      const paxHeader = () =>
        tarEntryBlocks({ name: 'x', type: 'x', data: bytesOf(paxRecord('path', 'x')) });
      const orphan = new Uint8Array([...paxHeader(), ...new Uint8Array(1024)]);
      expect((await listError(orphan)).message).toMatch(/extended header without an entry/);
      const twice = new Uint8Array([
        ...paxHeader(),
        ...tarWith([{ name: 'IM1', pax: { path: 'y' } }]),
      ]);
      expect((await listError(twice)).message).toMatch(/two extended headers/);
    });

    it('rejects an oversized extended header before reading it', async () => {
      const bytes = tarEntryBlocks({ name: 'x', type: 'x', declaredSize: 64 * 1024 * 1024 });
      expect((await listError(bytes)).code).toBe('UNSAFE_ARCHIVE');
    });
  });

  describe('limits', () => {
    it('stops above the entry limit (directories count)', async () => {
      const entries = Array.from({ length: 6 }, (_, n) => ({ name: `d${n}/`, type: '5' }));
      const error = await listError(tarWith(entries), { limits: { ...limits, maxArchiveEntries: 5 } });
      expect(error.code).toBe('LIMIT_EXCEEDED');
    });

    it('stops for an archive file above the size limit', async () => {
      const error = await listError(tarWith([{ name: 'IM1', data: dicom }]), {
        limits: { ...limits, maxArchiveBytes: 1024 },
      });
      expect(error.code).toBe('LIMIT_EXCEEDED');
    });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const entries = readTarEntries(fileOf(tarOf(tarStudy()), 'a.tar'), 'tar', limits, {
      signal: controller.signal,
    });
    const error = await (async () => {
      for await (const entry of entries) {
        void entry;
        controller.abort();
      }
    })().then(
      () => undefined,
      (e: unknown) => e
    );
    expect((error as LocalImportError).code).toBe('CANCELLED');
  });
});
