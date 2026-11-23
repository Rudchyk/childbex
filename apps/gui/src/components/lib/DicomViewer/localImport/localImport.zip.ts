/**
 * Bounded in-browser ZIP reading. The central directory is the source of
 * truth: every entry is validated (path, type, method, declared sizes,
 * overlap) before anything is decompressed, and decompression itself stops
 * as soon as an entry produces more than it declared. The archive is read
 * in slices, never loaded into memory as a whole.
 */
import { Inflate } from 'fflate';
import {
  checkPathLimits,
  formatBytes,
  normalizeArchivePath,
  readBlobBytes,
  throwIfCancelled,
  yieldToBrowser,
} from './localImport.files';
import { LocalImportError, type LocalImportLimits, type SkipReason } from './localImport.types';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_DIGITAL_SIGNATURE = 0x05054b50;
const EOCD_SIZE = 22;
const EOCD64_LOCATOR_SIZE = 20;
const EOCD64_SIZE = 56;
const ZIP64_SATURATED = 0xffffffff;
const MAX_COMMENT = 0xffff;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x1;
const FLAG_STRONG_ENCRYPTION = 0x40;
const HOST_UNIX = 3;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

/** Archive bytes read per slice. */
const READ_CHUNK = 1024 * 1024;
/**
 * Compressed bytes per inflate step: deflate expands at most ~1:1032, so
 * one step never produces more than ~16 MiB before the size check runs.
 */
const INFLATE_CHUNK = 16 * 1024;
/** Inflated bytes collected before they are moved into a Blob part. */
const FLUSH_BYTES = 4 * 1024 * 1024;
/** Inflated bytes between two pauses (Cancel, rendering). */
const PAUSE_BYTES = 8 * 1024 * 1024;

export interface ZipEntry {
  /** Normalised path inside the archive (`/` separated). */
  path: string;
  segments: string[];
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  /** Where the next entry (or the central directory) starts. */
  limitOffset: number;
  /** Set when the entry is not extracted. */
  skipReason?: SkipReason;
}

const corrupt = (detail: string) =>
  new LocalImportError(
    'CORRUPT_ARCHIVE',
    `The ZIP archive is damaged or incomplete (${detail}).`
  );
const unsafe = (detail: string) =>
  new LocalImportError(
    'UNSAFE_ARCHIVE',
    `The ZIP archive was rejected as unsafe (${detail}).`
  );

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const readRange = async (blob: Blob, start: number, end: number) => {
  if (start < 0 || end > blob.size || start > end) {
    throw corrupt('a record points outside the file');
  }
  return readBlobBytes(blob.slice(start, end));
};

const getUint64 = (dv: DataView, offset: number) => {
  const value = dv.getUint32(offset, true) + dv.getUint32(offset + 4, true) * 2 ** 32;
  if (!Number.isSafeInteger(value)) throw corrupt('size out of range');
  return value;
};

let crcTable: Uint32Array | undefined;
const getCrcTable = () => {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  return crcTable;
};

/** Running CRC-32 (start with `0`). */
export const crc32 = (crc: number, bytes: Uint8Array) => {
  const table = getCrcTable();
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

const decodeName = (bytes: Uint8Array) => {
  let ascii = true;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) ascii = false;
  // UTF-8 whether flagged (bit 11) or not: without the flag a name is CP437,
  // but archivers often write UTF-8 anyway. It only identifies the file.
  if (!ascii && typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(bytes);
  }
  let name = '';
  for (let i = 0; i < bytes.length; i++) name += String.fromCharCode(bytes[i]);
  return name;
};

/** Validates an entry name: no traversal, absolute or drive paths. */
export const normalizeZipPath = (rawName: string): string[] =>
  normalizeArchivePath(rawName, unsafe);

const findEndOfCentralDirectory = async (archive: Blob) => {
  const tailStart = Math.max(0, archive.size - EOCD_SIZE - MAX_COMMENT);
  const tail = await readRange(archive, tailStart, archive.size);
  const dv = view(tail);
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      const commentLength = dv.getUint16(i + 20, true);
      if (i + EOCD_SIZE + commentLength <= tail.length) {
        return { offset: tailStart + i, dv: view(tail.subarray(i, i + EOCD_SIZE)) };
      }
    }
  }
  throw corrupt('no end of central directory record');
};

/** Reads and validates the central directory of a ZIP archive. */
export const readZipDirectory = async (
  archive: Blob,
  limits: Pick<
    LocalImportLimits,
    | 'maxArchiveBytes'
    | 'maxArchiveEntries'
    | 'maxFileBytes'
    | 'maxPathDepth'
    | 'maxPathLength'
    | 'maxCompressionRatio'
    | 'ratioCheckMinBytes'
  >,
  signal?: AbortSignal
): Promise<ZipEntry[]> => {
  if (archive.size > limits.maxArchiveBytes) {
    throw new LocalImportError(
      'LIMIT_EXCEEDED',
      `A ZIP archive is larger than ${formatBytes(limits.maxArchiveBytes)}.`
    );
  }
  throwIfCancelled(signal);
  const eocd = await findEndOfCentralDirectory(archive);
  const ev = eocd.dv;
  if (ev.getUint16(4, true) !== 0 || ev.getUint16(6, true) !== 0) {
    throw new LocalImportError(
      'UNSUPPORTED_ARCHIVE',
      'Split (multi-part) ZIP archives are not supported.'
    );
  }
  // Entries on this disk and in total: one disk, so both must agree (an
  // archive whose counts disagree would lose entries silently).
  if (ev.getUint16(8, true) !== ev.getUint16(10, true)) {
    throw corrupt('contradictory entry counts');
  }
  let entryCount = ev.getUint16(10, true);
  let directorySize = ev.getUint32(12, true);
  let directoryOffset = ev.getUint32(16, true);
  let directoryEnd = eocd.offset;

  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    // ZIP64: the real values are in the ZIP64 end of central directory.
    const locatorOffset = eocd.offset - EOCD64_LOCATOR_SIZE;
    if (locatorOffset < 0) throw corrupt('missing ZIP64 locator');
    const lv = view(await readRange(archive, locatorOffset, eocd.offset));
    if (lv.getUint32(0, true) !== SIG_EOCD64_LOCATOR) throw corrupt('missing ZIP64 locator');
    if (lv.getUint32(4, true) !== 0 || lv.getUint32(16, true) > 1) {
      throw new LocalImportError(
        'UNSUPPORTED_ARCHIVE',
        'Split (multi-part) ZIP archives are not supported.'
      );
    }
    const recordOffset = getUint64(lv, 8);
    if (recordOffset + EOCD64_SIZE > locatorOffset) throw corrupt('invalid ZIP64 record offset');
    const rv = view(await readRange(archive, recordOffset, recordOffset + EOCD64_SIZE));
    if (rv.getUint32(0, true) !== SIG_EOCD64 || getUint64(rv, 4) < EOCD64_SIZE - 12) {
      throw corrupt('missing ZIP64 record');
    }
    // The record (with any extensible data) ends at its locator: nothing
    // unaccounted for in between.
    if (recordOffset + 12 + getUint64(rv, 4) !== locatorOffset) {
      throw corrupt('invalid ZIP64 record size');
    }
    if (rv.getUint32(16, true) !== 0 || rv.getUint32(20, true) !== 0) {
      throw new LocalImportError(
        'UNSUPPORTED_ARCHIVE',
        'Split (multi-part) ZIP archives are not supported.'
      );
    }
    if (getUint64(rv, 24) !== getUint64(rv, 32)) throw corrupt('contradictory entry counts');
    const zip64 = {
      entryCount: getUint64(rv, 32),
      directorySize: getUint64(rv, 40),
      directoryOffset: getUint64(rv, 48),
    };
    // Values not saturated in the ordinary record must be the same.
    if (
      (entryCount !== 0xffff && entryCount !== zip64.entryCount) ||
      (directorySize !== 0xffffffff && directorySize !== zip64.directorySize) ||
      (directoryOffset !== 0xffffffff && directoryOffset !== zip64.directoryOffset)
    ) {
      throw corrupt('contradictory ZIP64 record');
    }
    ({ entryCount, directorySize, directoryOffset } = zip64);
    directoryEnd = recordOffset;
  }

  if (entryCount > limits.maxArchiveEntries) {
    throw new LocalImportError(
      'LIMIT_EXCEEDED',
      `A ZIP archive has more than ${limits.maxArchiveEntries.toLocaleString('en-US')} entries.`
    );
  }
  // The central directory ends where its end record starts: records hidden
  // in a gap would otherwise be skipped silently.
  if (
    directorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
    directoryOffset + directorySize !== directoryEnd
  ) {
    throw corrupt('invalid central directory');
  }

  const directory = await readRange(archive, directoryOffset, directoryOffset + directorySize);
  const dv = view(directory);
  const entries: ZipEntry[] = [];
  const seenPaths = new Set<string>();
  let position = 0;

  for (let index = 0; index < entryCount; index++) {
    throwIfCancelled(signal);
    if (position + CENTRAL_SIZE > directory.length || dv.getUint32(position, true) !== SIG_CENTRAL) {
      throw corrupt('invalid central directory entry');
    }
    const madeBy = dv.getUint16(position + 4, true);
    const flags = dv.getUint16(position + 8, true);
    const method = dv.getUint16(position + 10, true);
    const crc = dv.getUint32(position + 16, true);
    let compressedSize = dv.getUint32(position + 20, true);
    let uncompressedSize = dv.getUint32(position + 24, true);
    const nameLength = dv.getUint16(position + 28, true);
    const extraLength = dv.getUint16(position + 30, true);
    const commentLength = dv.getUint16(position + 32, true);
    const externalAttributes = dv.getUint32(position + 38, true);
    let localHeaderOffset = dv.getUint32(position + 42, true);
    const nameStart = position + CENTRAL_SIZE;
    const extraStart = nameStart + nameLength;
    const next = extraStart + extraLength + commentLength;
    if (next > directory.length) throw corrupt('truncated central directory');

    // ZIP64 extended information: only the fields saturated above.
    let extra = extraStart;
    while (extra + 4 <= extraStart + extraLength) {
      const id = dv.getUint16(extra, true);
      const size = dv.getUint16(extra + 2, true);
      if (extra + 4 + size > extraStart + extraLength) throw corrupt('invalid extra field');
      if (id === 0x0001) {
        let field = extra + 4;
        const fieldEnd = extra + 4 + size;
        const take = () => {
          if (field + 8 > fieldEnd) throw corrupt('invalid ZIP64 field');
          const value = getUint64(dv, field);
          field += 8;
          return value;
        };
        if (uncompressedSize === ZIP64_SATURATED) uncompressedSize = take();
        if (compressedSize === ZIP64_SATURATED) compressedSize = take();
        if (localHeaderOffset === ZIP64_SATURATED) localHeaderOffset = take();
      }
      extra += 4 + size;
    }
    // A saturated field without its ZIP64 value: sizes/offset are unknown.
    if (
      uncompressedSize === ZIP64_SATURATED ||
      compressedSize === ZIP64_SATURATED ||
      localHeaderOffset === ZIP64_SATURATED
    ) {
      throw corrupt('missing ZIP64 field');
    }

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) {
      throw new LocalImportError(
        'UNSUPPORTED_ARCHIVE',
        'Password-protected (encrypted) ZIP archives are not supported. Extract the archive first.'
      );
    }

    const rawName = decodeName(directory.subarray(nameStart, extraStart));
    const segments = normalizeZipPath(rawName);
    position = next;
    const isDirectoryName = /[\\/]$/.test(rawName);
    const unixType = madeBy >> 8 === HOST_UNIX ? (externalAttributes >>> 16) & S_IFMT : 0;
    if (isDirectoryName || unixType === S_IFDIR || !segments.length) continue;
    checkPathLimits(segments, limits);

    const entry: ZipEntry = {
      path: segments.join('/'),
      segments,
      method,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      localHeaderOffset,
      limitOffset: directoryOffset,
    };
    if (unixType !== 0 && unixType !== S_IFREG) {
      // Links are never followed; devices and the like are not files.
      entry.skipReason = 'unsupported-entry';
    } else if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      entry.skipReason = 'unsupported-entry';
    } else if (method === METHOD_STORED && compressedSize !== uncompressedSize) {
      throw corrupt('stored entry sizes differ');
    } else if (uncompressedSize > limits.maxFileBytes) {
      entry.skipReason = 'too-large';
    } else if (seenPaths.has(entry.path)) {
      entry.skipReason = 'duplicate-path';
    }
    seenPaths.add(entry.path);
    entries.push(entry);
  }
  // Every byte of the declared directory is one of the declared entries:
  // more records (an entry count too small) or trailing data are
  // contradictory. A signed archive's digital signature record is not
  // supported.
  if (position !== directory.length) {
    if (position + 4 <= directory.length && dv.getUint32(position, true) === SIG_DIGITAL_SIGNATURE) {
      throw new LocalImportError(
        'UNSUPPORTED_ARCHIVE',
        'Digitally signed ZIP archives are not supported. Extract the archive first.'
      );
    }
    throw corrupt('the central directory has more records than declared');
  }

  // Entry data must not overlap (a known non-recursive ZIP bomb trick) and
  // must lie before the central directory.
  const byOffset = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  for (let i = 0; i < byOffset.length; i++) {
    const entry = byOffset[i];
    const limit = i + 1 < byOffset.length ? byOffset[i + 1].localHeaderOffset : directoryOffset;
    if (entry.localHeaderOffset + LOCAL_SIZE + entry.compressedSize > limit) {
      throw unsafe('overlapping or misplaced entries');
    }
    entry.limitOffset = limit;
  }

  const declared = entries
    .filter((e) => !e.skipReason)
    .reduce((total, e) => total + e.uncompressedSize, 0);
  if (
    declared > limits.ratioCheckMinBytes &&
    declared / Math.max(1, archive.size) > limits.maxCompressionRatio
  ) {
    throw unsafe('extreme compression ratio, possible ZIP bomb');
  }
  return entries;
};

export interface ExtractBudget {
  /** Bytes that may still be held in memory for extracted entries. */
  remainingBytes: number;
}

/**
 * Extracts and verifies (size and CRC-32) one entry. Stored entries are
 * returned as a slice of the archive (no copy); deflated ones are inflated
 * in small steps and count against `budget`.
 */
export const extractZipEntry = async (
  archive: Blob,
  entry: ZipEntry,
  options: {
    budget: ExtractBudget;
    signal?: AbortSignal;
    /** Compressed bytes consumed so far for this entry. */
    onProgress?: (compressedBytesRead: number) => void;
  }
): Promise<Blob> => {
  const { budget, signal, onProgress } = options;
  const local = view(
    await readRange(archive, entry.localHeaderOffset, entry.localHeaderOffset + LOCAL_SIZE)
  );
  if (local.getUint32(0, true) !== SIG_LOCAL) throw corrupt('invalid local header');
  if (local.getUint16(6, true) & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) {
    throw new LocalImportError(
      'UNSUPPORTED_ARCHIVE',
      'Password-protected (encrypted) ZIP archives are not supported. Extract the archive first.'
    );
  }
  const dataStart =
    entry.localHeaderOffset + LOCAL_SIZE + local.getUint16(26, true) + local.getUint16(28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > entry.limitOffset) throw unsafe('overlapping or misplaced entries');

  let crc = 0;
  let produced = 0;
  let producedAtPause = 0;
  // Inflated output is moved into Blob parts as it grows, so the entry is
  // never held twice (as chunks and as the final Blob).
  const parts: Blob[] = [];
  let chunks: Uint8Array[] = [];
  let chunkBytes = 0;
  const flush = () => {
    if (!chunks.length) return;
    parts.push(new Blob(chunks as BlobPart[]));
    chunks = [];
    chunkBytes = 0;
  };
  const inflate =
    entry.method === METHOD_DEFLATE
      ? new Inflate((data) => {
          produced += data.length;
          if (produced > entry.uncompressedSize) {
            throw unsafe('an entry expands beyond its declared size, possible ZIP bomb');
          }
          if (produced > budget.remainingBytes) {
            throw new LocalImportError(
              'LIMIT_EXCEEDED',
              'The ZIP archives expand to more data than can be previewed in the browser.'
            );
          }
          crc = crc32(crc, data);
          chunks.push(data);
          chunkBytes += data.length;
        })
      : undefined;

  try {
    if (inflate && entry.compressedSize === 0) inflate.push(new Uint8Array(0), true);
    for (let offset = dataStart; offset < dataEnd; ) {
      throwIfCancelled(signal);
      const end = Math.min(dataEnd, offset + READ_CHUNK);
      const slice = await readRange(archive, offset, end);
      if (inflate) {
        for (let i = 0; i < slice.length; i += INFLATE_CHUNK) {
          const isLast = end === dataEnd && i + INFLATE_CHUNK >= slice.length;
          inflate.push(slice.subarray(i, i + INFLATE_CHUNK), isLast);
          if (chunkBytes >= FLUSH_BYTES) flush();
          // Highly compressed data: pause so the page and Cancel respond.
          if (produced - producedAtPause >= PAUSE_BYTES) {
            producedAtPause = produced;
            await yieldToBrowser();
            throwIfCancelled(signal);
          }
        }
      } else {
        produced += slice.length;
        crc = crc32(crc, slice);
      }
      onProgress?.(end - dataStart);
      offset = end;
    }
  } catch (error) {
    if (error instanceof LocalImportError) throw error;
    throw new ZipEntryDamagedError();
  }

  if (produced !== entry.uncompressedSize || crc !== entry.crc32) {
    throw new ZipEntryDamagedError();
  }
  if (!inflate) return archive.slice(dataStart, dataEnd);
  budget.remainingBytes -= produced;
  flush();
  return new Blob(parts);
};

/** One entry is damaged (inflate error, size or CRC-32 mismatch). */
export class ZipEntryDamagedError extends Error {
  constructor() {
    // No entry path: names inside an archive may identify the patient.
    super('An archive entry is damaged.');
    this.name = 'ZipEntryDamagedError';
  }
}
