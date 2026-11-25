/**
 * Bounded, cancellable stream decompression of `.tar.gz`, `.tar.bz2` and
 * `.tar.xz` archives in the browser. The archive is read in slices (never
 * as a whole) and its decompressed bytes are handed out in small chunks;
 * the size of what is produced is checked while it is produced, so a
 * decompression bomb stops early. Decoders are loaded on first use.
 *
 * - gzip: fflate's streaming `Gunzip` (also used for ZIP). fflate does not
 *   check the gzip trailer, so the CRC-32 and size of every member are
 *   verified here.
 * - bzip2: the pure JavaScript block decoder of `unbzip2-stream` (the
 *   server's bzip2 decoder), driven one block at a time; it verifies block
 *   and stream CRCs.
 * - xz: `xz-decompress` (xz-embedded compiled to WebAssembly, also used by
 *   the server), which verifies CRC-32/CRC-64 checks and limits the LZMA2
 *   dictionary to 64 MiB.
 */
import { Gunzip } from 'fflate';
import {
  readBlobBytes,
  throwIfCancelled,
  yieldToBrowser,
} from './localImport.files';
import { crc32 } from './localImport.zip';
import { LocalImportError, type LocalImportLimits } from './localImport.types';

export type Compression = 'gzip' | 'bzip2' | 'xz';

export interface DecompressOptions {
  limits: Pick<LocalImportLimits, 'maxArchiveBytes' | 'maxCompressionRatio' | 'ratioCheckMinBytes'>;
  signal?: AbortSignal;
  /** Compressed bytes read so far. */
  onRead?: (compressedBytesRead: number) => void;
}

/** Archive bytes read per slice. */
const READ_CHUNK = 1024 * 1024;
/**
 * Compressed bytes per inflate step: deflate expands at most ~1:1032, so
 * one step never produces more than ~16 MiB before the size check runs.
 */
const INFLATE_CHUNK = 16 * 1024;
/** Compressed bytes handed to the xz decoder per read. */
const XZ_READ_CHUNK = 256 * 1024;
/** Decompressed bytes between two pauses (Cancel, rendering). */
const PAUSE_BYTES = 8 * 1024 * 1024;
/** bzip2 output is collected in chunks of this size. */
const BZIP2_OUT_CHUNK = 64 * 1024;
/**
 * Compressed bytes buffered before a bzip2 block is decoded (a block is
 * decoded synchronously): a block has at most 32,767 selectors of 50
 * symbols of at most 20 bits, i.e. ~4 MiB, plus its tables.
 */
const BZIP2_LOOKAHEAD = 5 * 1024 * 1024;

const LABELS: Record<Compression, string> = { gzip: 'gzip', bzip2: 'bzip2', xz: 'xz' };

const corrupt = (compression: Compression, detail: string) =>
  new LocalImportError(
    'CORRUPT_ARCHIVE',
    `The archive is damaged or incomplete (${LABELS[compression]} data: ${detail}).`
  );
const unsupported = (detail: string) =>
  new LocalImportError('UNSUPPORTED_ARCHIVE', `The archive uses an unsupported feature (${detail}).`);

/**
 * Checks the decompressed size while it grows: the TAR stream may not
 * exceed the archive size limit, and above `ratioCheckMinBytes` it may not
 * be more than `maxCompressionRatio` times the compressed size.
 */
const outputGuard = (archiveSize: number, limits: DecompressOptions['limits']) => {
  let produced = 0;
  return (bytes: number) => {
    produced += bytes;
    if (produced > limits.maxArchiveBytes) {
      throw new LocalImportError(
        'LIMIT_EXCEEDED',
        'A TAR archive expands to more data than can be previewed in the browser.'
      );
    }
    if (
      produced > limits.ratioCheckMinBytes &&
      produced / Math.max(1, archiveSize) > limits.maxCompressionRatio
    ) {
      throw new LocalImportError(
        'UNSAFE_ARCHIVE',
        'The archive was rejected as unsafe (extreme compression ratio, possible archive bomb).'
      );
    }
    return produced;
  };
};

/**
 * Called after each chunk handed out: stops when cancelled, and pauses
 * every `PAUSE_BYTES` of output so the page and Cancel respond.
 */
const pacer = (signal?: AbortSignal) => {
  let sincePause = 0;
  return async (bytes: number) => {
    throwIfCancelled(signal);
    sincePause += bytes;
    if (sincePause < PAUSE_BYTES) return;
    sincePause = 0;
    await yieldToBrowser();
    throwIfCancelled(signal);
  };
};

const readRange = (archive: Blob, start: number, end: number) =>
  readBlobBytes(archive.slice(start, end));

const uint32At = (bytes: Uint8Array, offset: number) =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

const GZIP_HEADER = 10;
const GZIP_TRAILER = 8;
const GZIP_RESERVED_FLAGS = 0xe0;

async function* gunzip(archive: Blob, options: DecompressOptions): AsyncGenerator<Uint8Array> {
  const { signal, onRead } = options;
  const guard = outputGuard(archive.size, options.limits);
  const pause = pacer(signal);
  if (archive.size < GZIP_HEADER + GZIP_TRAILER) throw corrupt('gzip', 'too short');

  /** Checks one member's header flags and (once it ended) its trailer. */
  const checkHeader = async (start: number) => {
    const header = await readRange(archive, start, start + GZIP_HEADER);
    if (header.length < 4 || header[0] !== 0x1f || header[1] !== 0x8b || header[2] !== 8) {
      throw corrupt('gzip', 'invalid header');
    }
    if (header[3] & GZIP_RESERVED_FLAGS) throw unsupported('reserved gzip header flags');
  };
  const checkTrailer = async (member: { start: number; end: number; crc: number; size: number }) => {
    if (member.end - member.start < GZIP_HEADER + GZIP_TRAILER) throw corrupt('gzip', 'truncated member');
    const trailer = await readRange(archive, member.end - GZIP_TRAILER, member.end);
    // ISIZE is the size modulo 2^32.
    if (uint32At(trailer, 0) !== member.crc || uint32At(trailer, 4) !== member.size % 2 ** 32) {
      throw corrupt('gzip', 'checksum or size mismatch');
    }
  };

  await checkHeader(0);
  let out: Uint8Array[] = [];
  let crc = 0;
  let size = 0;
  let memberStart = 0;
  /** Members whose end fflate reported (where the next one starts). */
  let ended: { start: number; end: number; crc: number; size: number }[] = [];
  const inflate = new Gunzip((data) => {
    if (!data.length) return;
    guard(data.length);
    crc = crc32(crc, data);
    size += data.length;
    out.push(data);
  });
  inflate.onmember = (offset) => {
    ended.push({ start: memberStart, end: offset, crc, size });
    memberStart = offset;
    crc = 0;
    size = 0;
  };

  for (let offset = 0; offset < archive.size; ) {
    throwIfCancelled(signal);
    const end = Math.min(archive.size, offset + READ_CHUNK);
    const slice = await readRange(archive, offset, end);
    for (let i = 0; i < slice.length; i += INFLATE_CHUNK) {
      try {
        inflate.push(slice.subarray(i, i + INFLATE_CHUNK), end === archive.size && i + INFLATE_CHUNK >= slice.length);
      } catch (error) {
        if (error instanceof LocalImportError) throw error;
        throw corrupt('gzip', 'invalid compressed data');
      }
      for (const member of ended) {
        await checkTrailer(member);
        await checkHeader(member.end);
      }
      ended = [];
      const chunks = out;
      out = [];
      for (const chunk of chunks) {
        yield chunk;
        await pause(chunk.length);
      }
    }
    onRead?.(end);
    offset = end;
  }
  // The last member ends with the file (nothing may follow its trailer).
  await checkTrailer({ start: memberStart, end: archive.size, crc, size });
}

type Bzip2Module = typeof import('unbzip2-stream/lib/bzip2.js');
type BitIteratorModule = typeof import('unbzip2-stream/lib/bit_iterator.js');

const interopDefault = <T>(module: T | { default: T }): T =>
  (module as { default?: T }).default ?? (module as T);

async function* bunzip2(archive: Blob, options: DecompressOptions): AsyncGenerator<Uint8Array> {
  const { signal, onRead } = options;
  const guard = outputGuard(archive.size, options.limits);
  const pause = pacer(signal);
  const [bzip2, bitIterator] = await Promise.all([
    import('unbzip2-stream/lib/bzip2.js').then((m) => interopDefault<Bzip2Module>(m)),
    import('unbzip2-stream/lib/bit_iterator.js').then((m) => interopDefault<BitIteratorModule>(m)),
  ]);

  // Compressed input read ahead (the decoder pulls it synchronously).
  const queue: Uint8Array[] = [];
  let queued = 0;
  let readOffset = 0;
  const TRUNCATED = new Error('truncated');
  const fill = async () => {
    while (queued < BZIP2_LOOKAHEAD && readOffset < archive.size) {
      throwIfCancelled(signal);
      const end = Math.min(archive.size, readOffset + READ_CHUNK);
      const bytes = await readRange(archive, readOffset, end);
      queue.push(bytes);
      queued += bytes.length;
      readOffset = end;
      onRead?.(readOffset);
    }
  };
  const nextBuffer = () => {
    const bytes = queue.shift();
    if (!bytes) throw TRUNCATED;
    queued -= bytes.length;
    return bytes;
  };

  let out: Uint8Array[] = [];
  let chunk = new Uint8Array(BZIP2_OUT_CHUNK);
  let chunkLength = 0;
  const flush = () => {
    if (!chunkLength) return;
    out.push(chunk.subarray(0, chunkLength));
    chunk = new Uint8Array(BZIP2_OUT_CHUNK);
    chunkLength = 0;
  };
  const write = (byte: number) => {
    chunk[chunkLength++] = byte;
    if (chunkLength === BZIP2_OUT_CHUNK) {
      // Checked per chunk, inside the block: a bomb stops early.
      guard(chunkLength);
      flush();
    }
  };
  const decode = <T>(step: () => T): T => {
    try {
      return step();
    } catch (error) {
      if (error instanceof LocalImportError) throw error;
      throw corrupt('bzip2', error === TRUNCATED ? 'unexpected end of data' : 'invalid compressed data');
    }
  };

  await fill();
  const bits = decode(() => bitIterator(nextBuffer));
  // One or more concatenated streams (e.g. from parallel bzip2 tools).
  do {
    const blockSize = decode(() => bzip2.header(bits));
    const bufferSize = 100_000 * blockSize;
    const buffer = new Int32Array(bufferSize);
    let streamCrc: number | null = 0;
    while (streamCrc !== null) {
      await fill();
      throwIfCancelled(signal);
      const crc: number = streamCrc;
      streamCrc = decode(() => bzip2.decompress(bits, write, buffer, bufferSize, crc));
      if (chunkLength) guard(chunkLength);
      flush();
      const chunks = out;
      out = [];
      for (const data of chunks) {
        yield data;
        await pause(data.length);
      }
    }
    // The end-of-stream marker was read and the reader aligned to a byte.
  } while (bits.bytesRead < archive.size);
}

/** xz-embedded's error codes (`get_next_output failed with error code N`). */
const XZ_UNSUPPORTED_CODES: Record<number, string> = {
  2: 'unsupported xz integrity check',
  3: 'xz decoder out of memory',
  4: 'xz dictionary larger than 64 MiB',
  6: 'unsupported xz options or filters (e.g. SHA-256 check)',
};

async function* unxz(archive: Blob, options: DecompressOptions): AsyncGenerator<Uint8Array> {
  const { signal, onRead } = options;
  const guard = outputGuard(archive.size, options.limits);
  const pause = pacer(signal);
  if (typeof WebAssembly === 'undefined' || typeof ReadableStream === 'undefined') {
    throw unsupported('this browser cannot decompress xz: no WebAssembly or web streams');
  }
  const { XzReadableStream } = await import('xz-decompress');

  let offset = 0;
  const source = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (offset >= archive.size) {
          controller.close();
          return;
        }
        const end = Math.min(archive.size, offset + XZ_READ_CHUNK);
        controller.enqueue(await readRange(archive, offset, end));
        offset = end;
        onRead?.(offset);
      },
    },
    { highWaterMark: 0 }
  );
  const reader = new XzReadableStream(source).getReader();
  let settled = false;
  try {
    for (;;) {
      throwIfCancelled(signal);
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (error) {
        settled = true;
        const code = Number(/error code (\d+)/.exec((error as Error)?.message ?? '')?.[1]);
        if (XZ_UNSUPPORTED_CODES[code]) throw unsupported(XZ_UNSUPPORTED_CODES[code]);
        throw corrupt('xz', 'invalid or truncated compressed data');
      }
      if (result.done) {
        settled = true;
        return;
      }
      if (!result.value.length) continue;
      guard(result.value.length);
      yield result.value;
      await pause(result.value.length);
    }
  } finally {
    // Cancel frees the decoder (its WebAssembly context and the lock that
    // lets only one xz stream be decoded at a time).
    if (!settled) await reader.cancel().catch(() => undefined);
  }
}

/**
 * The decompressed bytes of a gzip, bzip2 or xz file, in chunks (at most
 * 64 KiB for bzip2 and xz; up to ~16 MiB for highly compressed gzip). Throws
 * `LocalImportError`: `CORRUPT_ARCHIVE` (damaged, truncated, trailing data),
 * `UNSUPPORTED_ARCHIVE`, `UNSAFE_ARCHIVE` (compression ratio),
 * `LIMIT_EXCEEDED` or `CANCELLED`. Ending the iteration early (`return()`)
 * releases the decoder.
 */
export const decompress = (
  archive: Blob,
  compression: Compression,
  options: DecompressOptions
): AsyncGenerator<Uint8Array> => {
  switch (compression) {
    case 'gzip':
      return gunzip(archive, options);
    case 'bzip2':
      return bunzip2(archive, options);
    case 'xz':
      return unxz(archive, options);
  }
};
