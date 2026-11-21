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

export type ContentKind = 'dicom' | 'zip' | 'other';

/** Bytes needed by `sniffContent`. */
export const SNIFF_BYTES = 132;

/**
 * What a file is, by its first bytes (never by its extension: DICOM files
 * often have none). DICOM: Part 10 `DICM` magic, or (as dwv accepts) a
 * preamble-less data set starting with a group 0008 element.
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
  if (head.length >= 8 && head[0] === 0x08 && head[1] === 0x00) {
    return 'dicom';
  }
  return 'other';
};
