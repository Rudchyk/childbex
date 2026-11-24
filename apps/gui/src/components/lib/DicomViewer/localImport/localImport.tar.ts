/**
 * Bounded in-browser reading of TAR archives: `.tar`, and `.tar.gz`/`.tgz`,
 * `.tar.bz2`/`.tbz2`, `.tar.xz`/`.txz` (decompressed as a stream by
 * `localImport.decompress`). TAR has no central directory, so the archive is
 * read once, in order: each header is validated (checksum, numeric fields,
 * type) and its effective name, after PAX and GNU long-name records, goes
 * through the same path checks as a ZIP entry name before the entry is
 * handed out. Nothing is written anywhere and links are never followed.
 *
 * Entries of a plain TAR are slices of the archive file (no copy); entries
 * of a compressed TAR are copied out of the stream and count against the
 * memory budget.
 */
import { ARCHIVE_EXTENSIONS, type ArchiveExtension } from '@libs/constants';
import {
  checkPathLimits,
  formatBytes,
  isTarHeader,
  normalizeArchivePath,
  readBlobBytes,
  throwIfCancelled,
  yieldToBrowser,
  type ContentKind,
} from './localImport.files';
import { decompress, type Compression } from './localImport.decompress';
import type { ExtractBudget } from './localImport.zip';
import { LocalImportError, type LocalImportLimits, type SkipReason } from './localImport.types';

export type TarFormat = 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz';

const formatByExtension: Record<Exclude<ArchiveExtension, '.zip'>, TarFormat> = {
  '.tar': 'tar',
  '.tar.gz': 'tar.gz',
  '.tgz': 'tar.gz',
  '.tar.bz2': 'tar.bz2',
  '.tbz2': 'tar.bz2',
  '.tar.xz': 'tar.xz',
  '.txz': 'tar.xz',
};

/** The content signature each format must have. */
export const TAR_SIGNATURES: Record<TarFormat, ContentKind> = {
  tar: 'tar',
  'tar.gz': 'gzip',
  'tar.bz2': 'bzip2',
  'tar.xz': 'xz',
};

const COMPRESSION: Record<TarFormat, Compression | undefined> = {
  tar: undefined,
  'tar.gz': 'gzip',
  'tar.bz2': 'bzip2',
  'tar.xz': 'xz',
};

/** The TAR-family extensions, as accepted by the server (`.tar.gz`, `.tgz`…). */
export const TAR_EXTENSIONS = ARCHIVE_EXTENSIONS.filter(
  (extension): extension is Exclude<ArchiveExtension, '.zip'> => extension !== '.zip'
);

/** The TAR-family extension of a file name (longest match), if any. */
export const tarExtensionOf = (fileName: string) => {
  const lower = fileName.trim().toLowerCase();
  return [...TAR_EXTENSIONS]
    .sort((a, b) => b.length - a.length)
    .find((extension) => lower.endsWith(extension) && lower.length > extension.length);
};

export const tarFormatOf = (fileName: string): TarFormat | undefined => {
  const extension = tarExtensionOf(fileName);
  return extension && formatByExtension[extension];
};

const BLOCK = 512;
/** PAX extended header records (bytes). */
const MAX_PAX_BYTES = 1024 * 1024;
/** GNU long name / long link records (bytes). */
const MAX_LONG_NAME_BYTES = 64 * 1024;
/** Header bytes read ahead from a plain TAR (headers of small files). */
const HEADER_READ_AHEAD = 64 * 1024;
/** Bytes per step when skipping or checking data. */
const STEP = 1024 * 1024;
/** Inflated output collected before it is moved into a Blob part. */
const FLUSH_BYTES = 4 * 1024 * 1024;

const corrupt = (detail: string) =>
  new LocalImportError('CORRUPT_ARCHIVE', `The TAR archive is damaged or incomplete (${detail}).`);
const unsafe = (detail: string) =>
  new LocalImportError('UNSAFE_ARCHIVE', `The TAR archive was rejected as unsafe (${detail}).`);
const unsupported = (detail: string) =>
  new LocalImportError(
    'UNSUPPORTED_ARCHIVE',
    `The TAR archive uses an unsupported feature (${detail}). Extract the archive first.`
  );
const truncated = () => corrupt('unexpected end of data');

/** The (decompressed) TAR stream, read in order. */
interface TarInput {
  /** Bytes of the TAR stream consumed so far. */
  readonly position: number;
  /** Share of the archive file read so far (0–1). */
  progress(): number;
  /** Up to `n` next bytes, without consuming them (fewer at the end). */
  peek(n: number): Promise<Uint8Array>;
  /** Exactly `n` bytes (fewer only at the end). */
  read(n: number): Promise<Uint8Array>;
  skip(n: number): Promise<void>;
  /** `n` bytes as a Blob; throws when the stream ends first. */
  take(n: number, budget: ExtractBudget): Promise<Blob>;
  close(): Promise<void>;
}

/** A plain TAR file: data are slices of the file, headers read in batches. */
class BlobTarInput implements TarInput {
  position = 0;
  private cache: Uint8Array = new Uint8Array(0);
  private cacheStart = 0;

  constructor(private readonly file: Blob, private readonly signal?: AbortSignal) {}

  progress() {
    return this.file.size ? this.position / this.file.size : 1;
  }

  async peek(n: number) {
    const end = Math.min(this.file.size, this.position + n);
    const cacheEnd = this.cacheStart + this.cache.length;
    if (this.position < this.cacheStart || end > cacheEnd) {
      throwIfCancelled(this.signal);
      this.cacheStart = this.position;
      this.cache = await readBlobBytes(
        this.file.slice(this.position, Math.min(this.file.size, this.position + Math.max(n, HEADER_READ_AHEAD)))
      );
    }
    const from = this.position - this.cacheStart;
    return this.cache.subarray(from, from + (end - this.position));
  }

  async read(n: number) {
    const bytes = await this.peek(n);
    this.position += bytes.length;
    return bytes;
  }

  async skip(n: number) {
    if (this.position + n > this.file.size) throw truncated();
    this.position += n;
  }

  async take(n: number) {
    if (this.position + n > this.file.size) throw truncated();
    const blob = this.file.slice(this.position, this.position + n);
    this.position += n;
    return blob;
  }

  async close() {
    this.cache = new Uint8Array(0);
  }
}

/** A decompressed TAR stream (chunks from `decompress`). */
class StreamTarInput implements TarInput {
  position = 0;
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private ended = false;
  private compressedRead = 0;
  private readonly source: AsyncGenerator<Uint8Array>;

  constructor(
    private readonly file: Blob,
    compression: Compression,
    limits: LocalImportLimits,
    signal?: AbortSignal
  ) {
    this.source = decompress(file, compression, {
      limits,
      signal,
      onRead: (bytes) => {
        this.compressedRead = bytes;
      },
    });
  }

  progress() {
    return this.file.size ? this.compressedRead / this.file.size : 1;
  }

  /** Buffers at least `n` bytes, unless the stream ends first. */
  private async fill(n: number) {
    while (this.buffered < n && !this.ended) {
      const next = await this.source.next();
      if (next.done) {
        this.ended = true;
      } else if (next.value.length) {
        this.chunks.push(next.value);
        this.buffered += next.value.length;
      }
    }
  }

  /** Removes up to `n` buffered bytes, passing them to `use`. */
  private consume(n: number, onBytes?: (bytes: Uint8Array) => void) {
    let left = n;
    while (left > 0 && this.chunks.length) {
      const first = this.chunks[0];
      const part = first.length <= left ? first : first.subarray(0, left);
      if (part === first) this.chunks.shift();
      else this.chunks[0] = first.subarray(left);
      onBytes?.(part);
      left -= part.length;
      this.buffered -= part.length;
      this.position += part.length;
    }
    return n - left;
  }

  async peek(n: number) {
    await this.fill(n);
    const out = new Uint8Array(Math.min(n, this.buffered));
    let offset = 0;
    for (const chunk of this.chunks) {
      if (offset >= out.length) break;
      const part = chunk.subarray(0, out.length - offset);
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  async read(n: number) {
    const bytes = await this.peek(n);
    this.consume(bytes.length);
    return bytes;
  }

  async skip(n: number) {
    for (let left = n; left > 0; ) {
      await this.fill(Math.min(left, STEP));
      const done = this.consume(Math.min(left, STEP));
      if (!done) throw truncated();
      left -= done;
    }
  }

  async take(n: number, budget: ExtractBudget) {
    if (n > budget.remainingBytes) {
      throw new LocalImportError(
        'LIMIT_EXCEEDED',
        'The archives expand to more data than can be previewed in the browser.'
      );
    }
    budget.remainingBytes -= n;
    // Collected bytes are moved into Blob parts as they grow, so the file
    // is not held twice (as chunks and as the final Blob).
    const parts: Blob[] = [];
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    for (let left = n; left > 0; ) {
      await this.fill(Math.min(left, STEP));
      const done = this.consume(Math.min(left, STEP), (bytes) => {
        pending.push(bytes);
        pendingBytes += bytes.length;
      });
      if (!done) throw truncated();
      left -= done;
      if (pendingBytes >= FLUSH_BYTES) {
        parts.push(new Blob(pending as BlobPart[]));
        pending = [];
        pendingBytes = 0;
      }
    }
    parts.push(new Blob(pending as BlobPart[]));
    return new Blob(parts);
  }

  async close() {
    this.chunks = [];
    this.buffered = 0;
    // Releases the decoder when the archive is left early.
    await this.source.return(undefined);
  }
}

const latin1 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return text;
};

/** UTF-8 (names only identify files); Latin-1 where TextDecoder is missing. */
const utf8 = (bytes: Uint8Array) =>
  typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(bytes) : latin1(bytes);

/** A NUL-terminated header field or record. */
const decodeText = (bytes: Uint8Array) => {
  const end = bytes.indexOf(0);
  return utf8(end === -1 ? bytes : bytes.subarray(0, end));
};

/**
 * A numeric header field: octal digits (optionally space-padded, ending in
 * NUL or space), or GNU base-256 (first byte 0x80). Undefined when invalid.
 */
const numericField = (block: Uint8Array, offset: number, length: number) => {
  const field = block.subarray(offset, offset + length);
  if (field[0] === 0x80) {
    let value = 0;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i];
    return Number.isSafeInteger(value) ? value : undefined;
  }
  // 0xff: negative base-256 (never a valid size).
  if (field[0] & 0x80) return undefined;
  const match = /^ *([0-7]*)[ \0]*$/.exec(latin1(field));
  if (!match) return undefined;
  if (!match[1]) return 0;
  const value = parseInt(match[1], 8);
  return Number.isSafeInteger(value) ? value : undefined;
};

const isZeroBlock = (block: Uint8Array) => block.every((byte) => byte === 0);

/** POSIX ustar (`ustar\0` + version): the name may have a prefix field. */
const isPosixUstar = (block: Uint8Array) => latin1(block.subarray(257, 263)) === 'ustar\u0000';
const MAX_PAX_KEY_BYTES = 256;

/**
 * PAX extended header records: `"<length> <key>=<value>\n"`, the length
 * counting the whole record (in bytes, values in UTF-8).
 */
export const parsePaxRecords = (data: Uint8Array): Map<string, string> => {
  const records = new Map<string, string>();
  let offset = 0;
  // Trailing NUL padding is tolerated after the last record.
  while (offset < data.length && data[offset] !== 0) {
    let space = offset;
    while (space < data.length && space - offset < 20 && data[space] >= 0x30 && data[space] <= 0x39) {
      space++;
    }
    if (space === offset || data[space] !== 0x20) throw corrupt('invalid PAX record');
    const length = parseInt(latin1(data.subarray(offset, space)), 10);
    const end = offset + length;
    if (!Number.isSafeInteger(length) || end > data.length || end <= space + 1 || data[end - 1] !== 0x0a) {
      throw corrupt('invalid PAX record');
    }
    const record = data.subarray(space + 1, end - 1);
    const equals = record.indexOf(0x3d);
    if (equals <= 0 || equals > MAX_PAX_KEY_BYTES) throw corrupt('invalid PAX record');
    const key = latin1(record.subarray(0, equals));
    const valueBytes = record.subarray(equals + 1);
    // NUL inside a value would end the name early in other tools.
    if (valueBytes.includes(0)) throw unsafe('NUL character in a PAX record');
    // Tools differ in which of two values they use (first or last): a
    // repeated key could give this reader and another tool different names.
    if (records.has(key)) throw unsafe('repeated PAX key');
    records.set(key, utf8(valueBytes));
    offset = end;
  }
  if (data.subarray(offset).some((byte) => byte !== 0)) throw corrupt('invalid PAX record');
  return records;
};

/** PAX keys of a local (`x`) header that change how an entry is read. */
const checkPaxKeys = (records: Map<string, string>, global: boolean) => {
  for (const key of records.keys()) {
    if (key.startsWith('GNU.sparse.')) throw unsupported('sparse files');
    if (global && (key === 'path' || key === 'linkpath' || key === 'size')) {
      throw unsupported('global PAX path or size');
    }
    if (key === 'hdrcharset' && records.get(key) !== 'ISO-IR 10646 2000 UTF-8') {
      throw unsupported('non-UTF-8 PAX names');
    }
  }
};

/** Metadata records that apply to the next entry. */
interface PendingMeta {
  pax?: Map<string, string>;
  longName?: string;
  longLink?: string;
}

const TYPE_FILE = new Set(['0', '\0', '7']);
const TYPE_DIRECTORY = new Set(['5', 'D']);
/** Hard and symbolic links, character and block devices, FIFOs. */
const TYPE_SPECIAL = new Set(['1', '2', '3', '4', '6']);

export interface TarEntry {
  /** Normalised path inside the archive (`/` separated). */
  path: string;
  segments: string[];
  size: number;
  /** Set when the entry is not read (link, too large, duplicate path). */
  skipReason?: SkipReason;
  /** Up to `n` first bytes of the file. */
  head(n: number): Promise<Uint8Array>;
  /**
   * The file's bytes: a slice of a plain TAR (no copy), or a copy out of a
   * compressed TAR that counts against `budget`. Once per entry.
   */
  read(budget: ExtractBudget): Promise<Blob>;
}

export interface ReadTarOptions {
  signal?: AbortSignal;
  /** Share of the archive file read so far (0–1). */
  onProgress?: (fraction: number) => void;
}

/**
 * The files of a TAR archive, in order. Directories are left out; links,
 * devices and FIFOs come with `skipReason: 'unsupported-entry'`, files
 * above the size limit with `'too-large'`, repeated paths with
 * `'duplicate-path'` (none of them is read). Each entry must be used before
 * the next one is requested. Throws `LocalImportError` for damaged,
 * truncated, unsafe or unsupported archives and when a limit is reached.
 */
export async function* readTarEntries(
  archive: Blob,
  format: TarFormat,
  limits: LocalImportLimits,
  options: ReadTarOptions = {}
): AsyncGenerator<TarEntry> {
  const { signal, onProgress } = options;
  if (archive.size > limits.maxArchiveBytes) {
    throw new LocalImportError(
      'LIMIT_EXCEEDED',
      `An archive is larger than ${formatBytes(limits.maxArchiveBytes)}.`
    );
  }
  const compression = COMPRESSION[format];
  const input: TarInput = compression
    ? new StreamTarInput(archive, compression, limits, signal)
    : new BlobTarInput(archive, signal);
  const checkStreamSize = () => {
    // A plain TAR is within the archive size; a decompressed one is checked
    // by the decoder, this only bounds headers and skipped data.
    if (input.position > limits.maxArchiveBytes) {
      throw new LocalImportError(
        'LIMIT_EXCEEDED',
        'A TAR archive expands to more data than can be previewed in the browser.'
      );
    }
  };
  const readData = async (size: number, max: number) => {
    if (size > max) throw unsafe('oversized extended header');
    const data = await input.read(size);
    if (data.length < size) throw truncated();
    await input.skip(padding(size));
    return data;
  };

  let entryCount = 0;
  const seenPaths = new Set<string>();
  let meta: PendingMeta = {};
  let hasMeta = false;
  let headersSincePause = 0;

  try {
    for (;;) {
      throwIfCancelled(signal);
      checkStreamSize();
      onProgress?.(input.progress());
      if (++headersSincePause >= 200) {
        headersSincePause = 0;
        await yieldToBrowser();
        throwIfCancelled(signal);
      }
      const block = await input.read(BLOCK);
      if (!block.length) throw corrupt('no end-of-archive marker');
      if (block.length < BLOCK) throw truncated();

      if (isZeroBlock(block)) {
        if (hasMeta) throw corrupt('extended header without an entry');
        // End of archive: only zero padding may follow (no hidden entries).
        await expectZerosToEnd(input, signal, checkStreamSize);
        onProgress?.(1);
        return;
      }
      if (!isTarHeader(block)) throw corrupt('invalid header checksum');

      const type = String.fromCharCode(block[156]);
      const headerSize = numericField(block, 124, 12);
      if (headerSize === undefined) throw corrupt('invalid size field');

      // Metadata for the next entry.
      if (type === 'x' || type === 'g') {
        const records = parsePaxRecords(await readData(headerSize, MAX_PAX_BYTES));
        checkPaxKeys(records, type === 'g');
        if (type === 'x') {
          if (meta.pax) throw corrupt('two extended headers for one entry');
          meta.pax = records;
          hasMeta = true;
        }
        continue;
      }
      if (type === 'L' || type === 'K') {
        const value = decodeText(await readData(headerSize, MAX_LONG_NAME_BYTES));
        const key = type === 'L' ? 'longName' : 'longLink';
        if (meta[key] !== undefined) throw corrupt('two long names for one entry');
        meta[key] = value;
        hasMeta = true;
        continue;
      }

      if (++entryCount > limits.maxArchiveEntries) {
        throw new LocalImportError(
          'LIMIT_EXCEEDED',
          `An archive has more than ${limits.maxArchiveEntries.toLocaleString('en-US')} entries.`
        );
      }
      const pax = meta.pax;
      const paxSize = pax?.get('size');
      let size = headerSize;
      if (paxSize !== undefined && paxSize !== '') {
        if (!/^\d{1,16}$/.test(paxSize) || !Number.isSafeInteger(Number(paxSize))) {
          throw corrupt('invalid PAX size');
        }
        size = Number(paxSize);
      }
      const ustarName = () => {
        const name = decodeText(block.subarray(0, 100));
        // GNU headers (`ustar  \0`) use these bytes for other fields.
        const prefix = isPosixUstar(block) ? decodeText(block.subarray(345, 500)) : '';
        return prefix ? `${prefix}/${name}` : name;
      };
      // The effective name: PAX path, else GNU long name, else the header.
      const paxPath = pax?.get('path');
      const rawName = paxPath ? paxPath : meta.longName ?? ustarName();
      meta = {};
      hasMeta = false;

      const dataEnd = input.position + size + padding(size);
      const skipData = async () => {
        await input.skip(dataEnd - input.position);
      };

      if (type === 'V') {
        // GNU volume label: archive metadata, not a file.
        await skipData();
        continue;
      }
      if (type === 'S' || type === 'M') {
        throw unsupported(type === 'S' ? 'sparse files' : 'multi-volume archives');
      }
      const isFile = TYPE_FILE.has(type) && !/[\\/]$/.test(rawName);
      const isDirectory = TYPE_DIRECTORY.has(type) || (TYPE_FILE.has(type) && /[\\/]$/.test(rawName));
      if (!isFile && !isDirectory && !TYPE_SPECIAL.has(type)) {
        throw unsupported('an unknown entry type');
      }

      // Every name is validated, also of entries that are not read.
      const segments = normalizeArchivePath(rawName, unsafe);
      if (isDirectory) {
        if (segments.length) checkPathLimits(segments, limits);
        await skipData();
        continue;
      }
      if (!segments.length) throw corrupt('an entry without a name');
      checkPathLimits(segments, limits);
      const path = segments.join('/');

      let skipReason: SkipReason | undefined;
      if (!isFile) skipReason = 'unsupported-entry';
      else if (seenPaths.has(path)) skipReason = 'duplicate-path';
      else if (size > limits.maxFileBytes) skipReason = 'too-large';
      seenPaths.add(path);

      const dataStart = input.position;
      let used = false;
      yield {
        path,
        segments,
        size,
        skipReason,
        head: async (n) => {
          if (used || input.position !== dataStart) throw new Error('TAR entry already read');
          return input.peek(Math.min(n, size));
        },
        read: async (budget) => {
          if (used || input.position !== dataStart) throw new Error('TAR entry already read');
          used = true;
          return input.take(size, budget);
        },
      };
      used = true;
      await skipData();
    }
  } finally {
    await input.close();
  }
}

/** Data of an entry is padded to a whole 512-byte block. */
const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

/** After the end-of-archive marker, only zero bytes may follow. */
const expectZerosToEnd = async (
  input: TarInput,
  signal: AbortSignal | undefined,
  checkStreamSize: () => void
) => {
  for (;;) {
    throwIfCancelled(signal);
    checkStreamSize();
    const bytes = await input.read(STEP);
    if (!bytes.length) return;
    if (bytes.some((byte) => byte !== 0)) throw corrupt('data after the end-of-archive marker');
    await yieldToBrowser();
  }
};
