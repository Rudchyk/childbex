import { open } from 'node:fs/promises';
import { ARCHIVE_EXTENSIONS, ArchiveExtension } from '@libs/constants';
import { ArchiveError } from './archive.errors';

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'tar.bz2' | 'tar.xz';

export interface DetectedArchive {
  format: ArchiveFormat;
  /** Normalised extension from the allowlist, e.g. `.tar.gz`. */
  extension: ArchiveExtension;
}

type Signature =
  | 'zip'
  | 'gzip'
  | 'bzip2'
  | 'xz'
  | 'tar'
  | '7z'
  | 'rar'
  | 'empty'
  | 'unknown';

const formatByExtension: Record<ArchiveExtension, ArchiveFormat> = {
  '.zip': 'zip',
  '.tar': 'tar',
  '.tar.gz': 'tar.gz',
  '.tgz': 'tar.gz',
  '.tar.bz2': 'tar.bz2',
  '.tbz2': 'tar.bz2',
  '.tar.xz': 'tar.xz',
  '.txz': 'tar.xz',
};

const expectedSignature: Record<ArchiveFormat, Signature> = {
  zip: 'zip',
  tar: 'tar',
  'tar.gz': 'gzip',
  'tar.bz2': 'bzip2',
  'tar.xz': 'xz',
};

const HEADER_BYTES = 512;

const startsWith = (buf: Buffer, bytes: number[]) =>
  buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);

/** Validates a 512-byte tar header checksum (covers old v7 archives without `ustar` magic). */
const isTarHeader = (buf: Buffer): boolean => {
  if (buf.length < HEADER_BYTES) return false;
  if (buf.toString('latin1', 257, 262) === 'ustar') return true;
  const stored = parseInt(
    buf.toString('latin1', 148, 156).replace(/[\0 ]+$/g, ''),
    8
  );
  if (!Number.isFinite(stored)) return false;
  let sum = 0;
  for (let i = 0; i < HEADER_BYTES; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : buf[i];
  }
  return sum === stored && buf[0] !== 0;
};

export const sniffSignature = (head: Buffer): Signature => {
  if (head.length === 0) return 'empty';
  // Local file header or empty-archive end of central directory.
  if (
    startsWith(head, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(head, [0x50, 0x4b, 0x05, 0x06])
  ) {
    return 'zip';
  }
  if (startsWith(head, [0x1f, 0x8b])) return 'gzip';
  if (startsWith(head, [0x42, 0x5a, 0x68])) return 'bzip2';
  if (startsWith(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz';
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (startsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (isTarHeader(head)) return 'tar';
  return 'unknown';
};

/** Matches the client file name against the extension allowlist. */
export const extensionFromFileName = (
  fileName: string
): ArchiveExtension | undefined => {
  const lower = fileName.trim().toLowerCase();
  // Longest match first so `.tar.gz` wins over a shorter suffix.
  return [...ARCHIVE_EXTENSIONS]
    .sort((a, b) => b.length - a.length)
    .find((ext) => lower.endsWith(ext) && lower.length > ext.length);
};

const readHead = async (filePath: string): Promise<Buffer> => {
  const handle = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const supportedList = ARCHIVE_EXTENSIONS.join(', ');

/**
 * Determines the archive format from BOTH the client file name and the
 * content signature, and rejects archives where they disagree.
 */
export const detectArchiveFormat = async (
  filePath: string,
  clientFileName: string
): Promise<DetectedArchive> => {
  const signature = sniffSignature(await readHead(filePath));

  if (signature === 'rar') {
    throw new ArchiveError(
      'UNSUPPORTED_FORMAT',
      'RAR archives are not supported. Please repack the study as a ZIP archive and upload it again.'
    );
  }
  if (signature === '7z') {
    throw new ArchiveError(
      'UNSUPPORTED_FORMAT',
      '7z archives are not supported yet. Please repack the study as a ZIP archive and upload it again.'
    );
  }

  const extension = extensionFromFileName(clientFileName);
  if (!extension) {
    throw new ArchiveError(
      'UNSUPPORTED_FORMAT',
      `Unsupported archive type. Supported types: ${supportedList}.`
    );
  }
  const format = formatByExtension[extension];

  if (signature === 'empty') {
    throw new ArchiveError('CORRUPT_ARCHIVE', 'The uploaded archive is empty.');
  }
  if (signature !== expectedSignature[format]) {
    if (signature === 'unknown') {
      throw new ArchiveError(
        'CORRUPT_ARCHIVE',
        `The uploaded file is not a valid ${extension} archive or is corrupted.`
      );
    }
    throw new ArchiveError(
      'FORMAT_MISMATCH',
      `The file extension (${extension}) does not match the archive content.`
    );
  }
  return { format, extension };
};
