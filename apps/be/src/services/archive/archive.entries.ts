import path from 'node:path';
import { open } from 'node:fs/promises';
import sanitize from 'sanitize-filename';
import { ArchiveError } from './archive.errors';
import type { ArchiveLimits } from './archive.limits';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_SEGMENT_LENGTH = 255;
const MAX_OUTPUT_NAME_LENGTH = 120;
const MAX_LINK_TARGET_LENGTH = 4096;

const JUNK_FILE_NAMES = new Set([
  '.ds_store',
  'thumbs.db',
  'desktop.ini',
  // DICOMDIR is a media index; the import pipeline reads instances directly.
  'dicomdir',
]);
const JUNK_DIR_NAMES = new Set(['__macosx']);

const unsafe = (reason: string) =>
  new ArchiveError(
    'UNSAFE_ENTRY',
    `The archive was rejected because it contains an unsafe entry (${reason}).`
  );

/**
 * Validates an archive entry path and returns its normalised segments.
 * Rejects traversal, absolute/drive/UNC paths, control characters and
 * paths exceeding the configured length/depth.
 */
export const normalizeEntryPath = (
  rawName: string,
  limits: Pick<ArchiveLimits, 'maxPathDepth' | 'maxPathLength'>
): string[] => {
  if (rawName.length > limits.maxPathLength) {
    throw new ArchiveError(
      'LIMIT_EXCEEDED',
      'The archive contains a path that exceeds the allowed length.'
    );
  }
  if (CONTROL_CHARS.test(rawName)) throw unsafe('control characters in path');

  // Windows archivers may use backslashes as separators.
  const name = rawName.replace(/\\/g, '/');
  if (name.startsWith('/')) throw unsafe('absolute path');
  if (/^[a-zA-Z]:/.test(name)) throw unsafe('drive-letter path');

  const segments = name.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.some((s) => s === '..')) throw unsafe('path traversal');
  if (segments.some((s) => s.length > MAX_SEGMENT_LENGTH)) {
    throw new ArchiveError(
      'LIMIT_EXCEEDED',
      'The archive contains a file name that exceeds the allowed length.'
    );
  }
  if (segments.length > limits.maxPathDepth) {
    throw new ArchiveError(
      'LIMIT_EXCEEDED',
      'The archive contains directories nested deeper than allowed.'
    );
  }
  return segments;
};

export const isJunkDirectoryName = (name: string): boolean =>
  JUNK_DIR_NAMES.has(name.toLowerCase());

/** OS metadata and index files that are never imported. */
export const isJunkPath = (segments: string[]): boolean => {
  if (!segments.length) return true;
  const base = segments[segments.length - 1];
  return (
    segments.some(isJunkDirectoryName) ||
    base.startsWith('._') ||
    JUNK_FILE_NAMES.has(base.toLowerCase())
  );
};

/**
 * Checks that a link target stays inside the archive root.
 * Symlink targets are relative to the link's directory, hard link targets
 * to the archive root.
 */
const linkStaysInside = (
  segments: string[],
  target: string,
  kind: 'symlink' | 'hardlink'
): boolean => {
  const normalizedTarget = target.replace(/\\/g, '/');
  if (
    normalizedTarget === '' ||
    normalizedTarget.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalizedTarget) ||
    CONTROL_CHARS.test(normalizedTarget)
  ) {
    return false;
  }
  // Walk the target from the directory it is resolved against; any step
  // above the archive root means the link escapes.
  let depth = kind === 'symlink' ? segments.length - 1 : 0;
  for (const part of normalizedTarget.split('/')) {
    if (part === '..') depth -= 1;
    else if (part !== '' && part !== '.') depth += 1;
    if (depth < 0) return false;
  }
  return true;
};

/** Converts an entry base name into a safe, URL-friendly file name. */
const toSafeFileName = (base: string): string => {
  const cleaned = sanitize(base)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, MAX_OUTPUT_NAME_LENGTH);
  return cleaned || 'file';
};

export interface ExtractionStats {
  entries: number;
  filesWritten: number;
  bytesWritten: number;
  skippedJunk: number;
  skippedLinks: number;
  directories: number;
}

/**
 * Receives archive entries from a format adapter and materialises regular
 * files into a single flat directory. Entry paths are validated but never
 * used to build the output location, so nothing can be written outside
 * `destDir`. Links are never created.
 */
export class ExtractionSink {
  readonly stats: ExtractionStats = {
    entries: 0,
    filesWritten: 0,
    bytesWritten: 0,
    skippedJunk: 0,
    skippedLinks: 0,
    directories: 0,
  };
  readonly files: string[] = [];
  private readonly usedNames = new Set<string>();

  constructor(
    private readonly destDir: string,
    private readonly limits: ArchiveLimits,
    private readonly signal?: AbortSignal
  ) {}

  private countEntry(rawName: string): string[] {
    this.stats.entries += 1;
    if (this.stats.entries > this.limits.maxEntries) {
      throw new ArchiveError(
        'LIMIT_EXCEEDED',
        `The archive contains more than ${this.limits.maxEntries} entries.`
      );
    }
    return normalizeEntryPath(rawName, this.limits);
  }

  checkDeclaredTotals(entryCount: number, declaredBytes: number) {
    if (entryCount > this.limits.maxEntries) {
      throw new ArchiveError(
        'LIMIT_EXCEEDED',
        `The archive contains more than ${this.limits.maxEntries} entries.`
      );
    }
    if (declaredBytes > this.limits.maxExtractedBytes) {
      throw this.totalSizeError();
    }
  }

  addDirectory(rawName: string) {
    this.countEntry(rawName);
    this.stats.directories += 1;
  }

  addLink(rawName: string, target: string, kind: 'symlink' | 'hardlink') {
    const segments = this.countEntry(rawName);
    if (
      target.length > MAX_LINK_TARGET_LENGTH ||
      !linkStaysInside(segments, target, kind)
    ) {
      throw unsafe(`${kind} pointing outside the archive`);
    }
    this.stats.skippedLinks += 1;
  }

  rejectEntryType(rawName: string, type: string) {
    this.countEntry(rawName);
    throw unsafe(`unsupported entry type "${type}"`);
  }

  /**
   * Validates and writes a regular file. Returns the written path, or null
   * when the entry is skipped (the caller must then drain/discard its data).
   */
  async addFile(
    rawName: string,
    declaredSize: number | undefined,
    openData: () => Promise<AsyncIterable<Buffer | Uint8Array>>
  ): Promise<string | null> {
    const segments = this.countEntry(rawName);
    if (isJunkPath(segments)) {
      this.stats.skippedJunk += 1;
      return null;
    }
    if (declaredSize !== undefined) {
      if (declaredSize > this.limits.maxEntryBytes) throw this.entrySizeError();
      if (
        this.stats.bytesWritten + declaredSize >
        this.limits.maxExtractedBytes
      )
        throw this.totalSizeError();
    }

    const target = path.join(this.destDir, this.uniqueName(segments));
    const handle = await open(target, 'wx', 0o600);
    let entryBytes = 0;
    try {
      for await (const chunk of await openData()) {
        this.signal?.throwIfAborted();
        entryBytes += chunk.length;
        this.stats.bytesWritten += chunk.length;
        if (entryBytes > this.limits.maxEntryBytes) throw this.entrySizeError();
        if (this.stats.bytesWritten > this.limits.maxExtractedBytes)
          throw this.totalSizeError();
        await handle.write(chunk);
      }
    } finally {
      await handle.close();
    }
    this.stats.filesWritten += 1;
    this.files.push(target);
    return target;
  }

  private uniqueName(segments: string[]): string {
    const base = toSafeFileName(segments[segments.length - 1]);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length) || 'file';
    let candidate = base;
    for (let n = 1; this.usedNames.has(candidate.toLowerCase()); n++) {
      candidate = `${stem}_${n}${ext}`;
    }
    // Case-insensitive to stay collision-free on Windows/macOS file systems.
    this.usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  private entrySizeError() {
    return new ArchiveError(
      'LIMIT_EXCEEDED',
      'The archive contains a file larger than the allowed size.'
    );
  }

  private totalSizeError() {
    return new ArchiveError(
      'LIMIT_EXCEEDED',
      'The extracted archive content exceeds the allowed total size.'
    );
  }
}
