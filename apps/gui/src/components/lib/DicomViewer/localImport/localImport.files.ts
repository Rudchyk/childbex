import { LocalImportError, type LocalImportLimits } from './localImport.types';

/** Reads a Blob (or a slice of it); FileReader where `arrayBuffer` is missing. */
export const readBlobBytes = (blob: Blob): Promise<Uint8Array> => {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
};

export const formatBytes = (bytes: number) => {
  const KiB = 1024;
  const MiB = KiB * 1024;
  const GiB = MiB * 1024;
  if (bytes >= GiB) return `${+(bytes / GiB).toFixed(1)} GB`;
  if (bytes >= MiB) return `${+(bytes / MiB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / KiB))} KB`;
};

export const throwIfCancelled =(signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new LocalImportError('CANCELLED', 'The import was cancelled.');
  }
};

/** Lets the browser render and handle input between chunks of work. */
export const yieldToBrowser = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const JUNK_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const JUNK_DIR_NAMES = new Set(['__macosx']);

/** OS metadata files and folders (never DICOM). */
export const isSystemPath = (segments: readonly string[]): boolean => {
  const base = segments[segments.length - 1] ?? '';
  return (
    segments.some((s) => JUNK_DIR_NAMES.has(s.toLowerCase())) ||
    base.startsWith('._') ||
    JUNK_FILE_NAMES.has(base.toLowerCase())
  );
};

export const isDicomDirName = (name: string) => name.toLowerCase() === 'dicomdir';

export const splitPath = (path: string) =>
  path.split('/').filter((s) => s !== '' && s !== '.');

export const baseName = (path: string) => {
  const segments = splitPath(path);
  return segments[segments.length - 1] ?? path;
};

/** Depth and length limits for a relative path (folders and archives). */
export const checkPathLimits = (
  segments: readonly string[],
  limits: Pick<LocalImportLimits, 'maxPathDepth' | 'maxPathLength'>
) => {
  if (segments.length > limits.maxPathDepth) {
    throw new LocalImportError(
      'LIMIT_EXCEEDED',
      `Folders are nested deeper than ${limits.maxPathDepth} levels.`
    );
  }
  if (segments.join('/').length > limits.maxPathLength) {
    throw new LocalImportError(
      'LIMIT_EXCEEDED',
      `A file path is longer than ${limits.maxPathLength} characters.`
    );
  }
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
/** Bidirectional overrides and isolates: a name could display as another. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/;

/**
 * Validates a path inside an archive (ZIP entry name, or a TAR name after
 * its PAX / GNU extensions are applied): no control characters, absolute,
 * drive-letter, UNC or traversal paths. Returns the normalised segments;
 * `unsafe` builds the archive's error (never containing the raw name).
 */
export const normalizeArchivePath = (
  rawName: string,
  unsafe: (detail: string) => Error
): string[] => {
  if (CONTROL_CHARS.test(rawName)) throw unsafe('control characters in a path');
  if (BIDI_CONTROLS.test(rawName)) throw unsafe('text direction characters in a path');
  const name = rawName.replace(/\\/g, '/');
  // Also `\\server\share` (UNC), once separators are normalised.
  if (name.startsWith('/')) throw unsafe('absolute path');
  if (/^[a-zA-Z]:/.test(name)) throw unsafe('drive-letter path');
  const segments = name.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) throw unsafe('path traversal');
  return segments;
};

export type ArchiveKind = 'zip' | 'tar' | 'gzip' | 'bzip2' | 'xz';
export type ContentKind = 'dicom' | ArchiveKind | 'other';

/** Bytes needed by `sniffContent` (a TAR header is one 512-byte block). */
export const SNIFF_BYTES = 512;

const TAR_BLOCK = 512;
const TAR_CHECKSUM_OFFSET = 148;
const TAR_CHECKSUM_LENGTH = 8;

/**
 * Whether a 512-byte block is a TAR header: its checksum field (octal)
 * matches the sum of its bytes, counting the field itself as spaces. Old
 * implementations summed signed bytes; both are accepted. Works for v7
 * headers without the `ustar` magic too. An all-zero block is not a header.
 */
export const isTarHeader = (block: Uint8Array): boolean => {
  if (block.length < TAR_BLOCK) return false;
  const field = String.fromCharCode(
    ...block.subarray(TAR_CHECKSUM_OFFSET, TAR_CHECKSUM_OFFSET + TAR_CHECKSUM_LENGTH)
  );
  const match = /^ *([0-7]{1,7})[ \0]*$/.exec(field);
  if (!match) return false;
  const stored = parseInt(match[1], 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    const byte =
      i >= TAR_CHECKSUM_OFFSET && i < TAR_CHECKSUM_OFFSET + TAR_CHECKSUM_LENGTH ? 0x20 : block[i];
    unsigned += byte;
    signed += byte > 0x7f ? byte - 0x100 : byte;
  }
  // An all-zero block would sum to 256 (the spaces) and never match "0".
  return stored === unsigned || stored === signed;
};

const startsWith = (head: Uint8Array, bytes: readonly number[]) =>
  head.length >= bytes.length && bytes.every((b, i) => head[i] === b);

const BZIP2_BLOCK_MAGIC = [0x31, 0x41, 0x59, 0x26, 0x53, 0x59];
const BZIP2_END_MAGIC = [0x17, 0x72, 0x45, 0x38, 0x50, 0x90];

/** `BZh` + block size `1`–`9`, then a block or the end-of-stream marker. */
const isBzip2 = (head: Uint8Array) =>
  startsWith(head, [0x42, 0x5a, 0x68]) &&
  head.length >= 10 &&
  head[3] >= 0x31 &&
  head[3] <= 0x39 &&
  (startsWith(head.subarray(4), BZIP2_BLOCK_MAGIC) ||
    startsWith(head.subarray(4), BZIP2_END_MAGIC));

/**
 * What a file is, by its first bytes (never by its extension: DICOM files
 * often have none). DICOM: Part 10 `DICM` magic, or (as dwv accepts) a
 * preamble-less data set starting with a group 0008 element. Archives: ZIP,
 * gzip (deflate), bzip2 and xz signatures, or a TAR header checksum
 * (needs `SNIFF_BYTES`).
 */
export const sniffContent = (head: Uint8Array): ContentKind => {
  if (
    head.length >= 132 &&
    head[128] === 0x44 && // D
    head[129] === 0x49 && // I
    head[130] === 0x43 && // C
    head[131] === 0x4d // M
  ) {
    return 'dicom';
  }
  if (
    head.length >= 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    ((head[2] === 0x03 && head[3] === 0x04) ||
      (head[2] === 0x05 && head[3] === 0x06))
  ) {
    return 'zip';
  }
  if (startsWith(head, [0x1f, 0x8b, 0x08])) return 'gzip';
  if (isBzip2(head)) return 'bzip2';
  if (startsWith(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (head.length >= 8 && head[0] === 0x08 && head[1] === 0x00) {
    return 'dicom';
  }
  if (isTarHeader(head)) return 'tar';
  return 'other';
};

export const isArchiveKind = (kind: ContentKind): kind is ArchiveKind =>
  kind !== 'dicom' && kind !== 'other';
