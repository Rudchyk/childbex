/**
 * Stream decompression of `.tar.gz`, `.tar.bz2` and `.tar.xz`: the real
 * decoders, with damaged, truncated and hostile input.
 */
import { ReadableStream } from 'stream/web';
import { gzipSync } from 'fflate';
import { fileOf } from './__fixtures__/syntheticDicom';
import {
  TAR_STUDY_BZ2,
  TAR_STUDY_XZ,
  tarOf,
  tarStudy,
  ZEROS_BZ2,
  ZEROS_XZ,
} from './__fixtures__/tarFixtures';
import { decompress, type Compression, type DecompressOptions } from './localImport.decompress';
import { defaultLocalImportLimits, LocalImportError } from './localImport.types';
import { crc32 } from './localImport.zip';

// The browser's web streams (jsdom has none).
Object.assign(globalThis, { ReadableStream: globalThis.ReadableStream ?? ReadableStream });

const MiB = 1024 * 1024;
const limits = { ...defaultLocalImportLimits };
const tar = tarOf(tarStudy());
const TAR_GZ = gzipSync(tar);
const fixtures: Record<Compression, Uint8Array> = {
  gzip: TAR_GZ,
  bzip2: TAR_STUDY_BZ2,
  xz: TAR_STUDY_XZ,
};
const ZEROS: Record<Compression, Uint8Array> = {
  gzip: gzipSync(new Uint8Array(4 * MiB)),
  bzip2: ZEROS_BZ2,
  xz: ZEROS_XZ,
};
const compressions = ['gzip', 'bzip2', 'xz'] as const;

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const collect = async (
  bytes: Uint8Array,
  compression: Compression,
  options: Partial<DecompressOptions> = {}
) => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of decompress(fileOf(bytes, 'archive'), compression, { limits, ...options })) {
    chunks.push(chunk);
  }
  return concat(chunks);
};

/** The error, and how many bytes were produced before it. */
const failure = async (
  bytes: Uint8Array,
  compression: Compression,
  options: Partial<DecompressOptions> = {}
) => {
  let produced = 0;
  try {
    for await (const chunk of decompress(fileOf(bytes, 'archive'), compression, {
      limits,
      ...options,
    })) {
      produced += chunk.length;
    }
  } catch (error) {
    expect(error).toBeInstanceOf(LocalImportError);
    return { error: error as LocalImportError, produced };
  }
  throw new Error('expected a failure');
};

const flip = (bytes: Uint8Array, offset: number) => {
  const copy = bytes.slice();
  copy[offset] ^= 0x55;
  return copy;
};

describe('decompress', () => {
  it.each(compressions)('%s: produces exactly the original TAR stream', async (compression) => {
    expect(await collect(fixtures[compression], compression)).toEqual(tar);
  });

  it.each(compressions)('%s: reads concatenated streams (members)', async (compression) => {
    const twice = concat([fixtures[compression], fixtures[compression]]);
    expect(await collect(twice, compression)).toEqual(concat([tar, tar]));
  });

  it.each(compressions)('%s: rejects truncated data', async (compression) => {
    const bytes = fixtures[compression];
    for (const length of [bytes.length - 1, bytes.length - 4, Math.floor(bytes.length / 2), 12]) {
      const { error } = await failure(bytes.slice(0, length), compression);
      expect(error.code).toBe('CORRUPT_ARCHIVE');
    }
  });

  it.each(compressions)('%s: rejects damaged compressed data', async (compression) => {
    const bytes = fixtures[compression];
    const { error } = await failure(flip(bytes, Math.floor(bytes.length / 2)), compression);
    expect(error.code).toBe('CORRUPT_ARCHIVE');
  });

  it.each(compressions)('%s: rejects data after the end of the stream', async (compression) => {
    for (const junk of [[0x78, 0x79], [0x6a, 0x75, 0x6e, 0x6b, 0x6a, 0x75, 0x6e, 0x6b]]) {
      const { error } = await failure(concat([fixtures[compression], Uint8Array.from(junk)]), compression);
      expect(error.code).toBe('CORRUPT_ARCHIVE');
    }
  });

  it.each(compressions)('%s: rejects an empty file', async (compression) => {
    const { error } = await failure(new Uint8Array(0), compression);
    expect(error.code).toBe('CORRUPT_ARCHIVE');
  });

  describe('gzip trailer and header', () => {
    it('rejects a wrong CRC-32 or size in the trailer (fflate does not check them)', async () => {
      const crc = flip(TAR_GZ, TAR_GZ.length - 8);
      expect((await failure(crc, 'gzip')).error.message).toMatch(/checksum or size mismatch/);
      const size = flip(TAR_GZ, TAR_GZ.length - 1);
      expect((await failure(size, 'gzip')).error.message).toMatch(/checksum or size mismatch/);
    });

    it('checks the trailer of every member', async () => {
      const first = flip(TAR_GZ, TAR_GZ.length - 8);
      const { error } = await failure(concat([first, TAR_GZ]), 'gzip');
      expect(error.message).toMatch(/checksum or size mismatch/);
    });

    it('rejects reserved header flags', async () => {
      const bytes = TAR_GZ.slice();
      bytes[3] |= 0x80;
      expect((await failure(bytes, 'gzip')).error.code).toBe('UNSUPPORTED_ARCHIVE');
    });
  });

  describe('xz', () => {
    it('rejects an unsupported integrity check (SHA-256) as unsupported', async () => {
      // Stream header flags: check ID 0x0A (SHA-256), with a valid CRC-32.
      const bytes = TAR_STUDY_XZ.slice();
      bytes[7] = 0x0a;
      new DataView(bytes.buffer).setUint32(8, crc32(0, bytes.subarray(6, 8)), true);
      const { error } = await failure(bytes, 'xz');
      expect(error.code).toBe('UNSUPPORTED_ARCHIVE');
    });

    it('rejects a dictionary above 64 MiB (memory) as unsupported', async () => {
      // LZMA2 dictionary size byte of the first block's filter flags (32 =
      // 256 MiB), with the block header CRC-32 recomputed.
      const bytes = TAR_STUDY_XZ.slice();
      const blockStart = 12;
      const headerSize = (bytes[blockStart] + 1) * 4;
      // Block header: size, flags, filter ID 0x21, properties size 1, dict.
      const dictionary = bytes.indexOf(0x21, blockStart + 2) + 2;
      bytes[dictionary] = 32;
      new DataView(bytes.buffer).setUint32(
        blockStart + headerSize - 4,
        crc32(0, bytes.subarray(blockStart, blockStart + headerSize - 4)),
        true
      );
      const { error } = await failure(bytes, 'xz');
      expect(error.code).toBe('UNSUPPORTED_ARCHIVE');
      expect(error.message).toMatch(/dictionary/);
    });
  });

  describe('decompression bombs', () => {
    const bombLimits = { ...limits, ratioCheckMinBytes: MiB, maxCompressionRatio: 100 };

    it.each(compressions)('%s: stops a highly compressible stream early', async (compression) => {
      const { error, produced } = await failure(ZEROS[compression], compression, {
        limits: bombLimits,
      });
      expect(error.code).toBe('UNSAFE_ARCHIVE');
      expect(error.message).toMatch(/possible archive bomb/);
      // Stopped while decompressing, not after producing everything.
      expect(produced).toBeLessThan(4 * MiB);
    });

    it.each(compressions)('%s: stops at the TAR stream size limit', async (compression) => {
      const { error, produced } = await failure(ZEROS[compression], compression, {
        limits: { ...limits, maxArchiveBytes: 2 * MiB },
      });
      expect(error.code).toBe('LIMIT_EXCEEDED');
      expect(produced).toBeLessThanOrEqual(2 * MiB);
    });
  });

  describe('cancellation', () => {
    it.each(compressions)('%s: stops when cancelled', async (compression) => {
      const controller = new AbortController();
      let chunks = 0;
      const promise = (async () => {
        for await (const chunk of decompress(fileOf(ZEROS[compression], 'z'), compression, {
          limits,
          signal: controller.signal,
        })) {
          if (chunk.length && ++chunks === 1) controller.abort();
        }
      })();
      await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
    });

    it('releases the xz decoder when left early, so the next archive decodes', async () => {
      const iterator = decompress(fileOf(ZEROS_XZ, 'z'), 'xz', { limits });
      await iterator.next();
      await iterator.return(undefined);
      // xz-decompress lets one stream decode at a time: a leaked decoder
      // would make this wait forever.
      expect(await collect(TAR_STUDY_XZ, 'xz')).toEqual(tar);
    });

    it('releases the xz decoder after a failure', async () => {
      await failure(TAR_STUDY_XZ.slice(0, 100), 'xz');
      await failure(ZEROS_XZ, 'xz', { limits: { ...limits, maxArchiveBytes: MiB } });
      expect(await collect(TAR_STUDY_XZ, 'xz')).toEqual(tar);
    });
  });

  it('reports the compressed bytes read', async () => {
    const onRead = jest.fn();
    await collect(TAR_STUDY_BZ2, 'bzip2', { onRead });
    expect(onRead).toHaveBeenLastCalledWith(TAR_STUDY_BZ2.length);
  });
});
