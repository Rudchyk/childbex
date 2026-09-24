import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ArchiveError, isArchiveError } from './archive.errors';
import { archiveLimits, type ArchiveLimits } from './archive.limits';
import { detectArchiveFormat, type DetectedArchive } from './archive.detect';
import {
  ExtractionSink,
  isJunkDirectoryName,
  isJunkPath,
  type ExtractionStats,
} from './archive.entries';
import { extractTar, extractZip } from './archive.formats';
import { logger } from '../logger.service';

export { ArchiveError, isArchiveError } from './archive.errors';
export { archiveLimits, type ArchiveLimits } from './archive.limits';

/** Base directory for per-upload temporary workspaces. */
export const uploadWorkRoot = path.resolve(
  process.env.ARCHIVE_WORK_DIR || path.join(tmpdir(), 'childbex-uploads')
);

/**
 * Runs `fn` inside a fresh, private temporary directory that is always
 * removed afterwards, whether `fn` succeeds or fails.
 * A cleanup failure is logged, never thrown: it must not turn an import
 * that was already committed into a reported failure, nor mask `fn`'s error.
 */
export const withUploadWorkspace = async <T>(
  fn: (workspace: string) => Promise<T>,
  root: string = uploadWorkRoot
): Promise<T> => {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(path.join(root, 'upload-'));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    }).catch((error) =>
      logger.error(
        { err: error, workspace },
        'failed to remove upload workspace'
      )
    );
  }
};

export interface SavedUpload {
  path: string;
  size: number;
  sha256: string;
}

/**
 * Streams the uploaded file into the workspace under an internal name,
 * enforcing the upload limit and computing its SHA-256 checksum.
 */
export const saveUploadToWorkspace = async (
  file: Blob,
  workspace: string,
  limits: Pick<ArchiveLimits, 'maxUploadBytes'> = archiveLimits
): Promise<SavedUpload> => {
  const tooLarge = () =>
    new ArchiveError(
      'UPLOAD_TOO_LARGE',
      `The archive exceeds the maximum upload size of ${Math.floor(
        limits.maxUploadBytes / 1024 / 1024
      )} MB.`
    );
  if (file.size > limits.maxUploadBytes) throw tooLarge();

  const target = path.join(workspace, 'upload.bin');
  const hash = createHash('sha256');
  const handle = await open(target, 'wx', 0o600);
  let size = 0;
  try {
    const reader = file.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limits.maxUploadBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      hash.update(value);
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
  return { path: target, size, sha256: hash.digest('hex') };
};

export interface ExtractedArchive extends DetectedArchive {
  /** Extracted regular files (flat, safe names inside `destDir`). */
  files: string[];
  stats: ExtractionStats;
}

const toArchiveError = (error: unknown, signal: AbortSignal): ArchiveError => {
  if (isArchiveError(error)) return error;
  if (signal.aborted) {
    return new ArchiveError(
      'LIMIT_EXCEEDED',
      'Archive extraction took longer than allowed.',
      { cause: error }
    );
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code && /^E[A-Z]+$/.test(code) && code !== 'EINVAL') {
    // File system problem on the server (disk full, permissions, ...).
    return new ArchiveError(
      'EXTRACTION_FAILED',
      'The archive could not be extracted on the server.',
      { cause: error }
    );
  }
  return new ArchiveError(
    'CORRUPT_ARCHIVE',
    'The archive is corrupted or uses an unsupported feature.',
    { cause: error }
  );
};

/**
 * Validates and safely extracts an uploaded archive into `destDir`.
 * Nested archives are not extracted; they are returned as regular files.
 */
export const extractArchive = async (
  archivePath: string,
  clientFileName: string,
  destDir: string,
  limits: ArchiveLimits = archiveLimits
): Promise<ExtractedArchive> => {
  const detected = await detectArchiveFormat(archivePath, clientFileName);
  await mkdir(destDir, { recursive: true, mode: 0o700 });

  const signal = AbortSignal.timeout(limits.timeoutMs);
  const sink = new ExtractionSink(destDir, limits, signal);
  try {
    if (detected.format === 'zip') {
      await extractZip(archivePath, sink, signal);
    } else {
      await extractTar(archivePath, detected.format, sink, signal);
    }
  } catch (error) {
    throw toArchiveError(error, signal);
  }
  return { ...detected, files: [...sink.files], stats: { ...sink.stats } };
};

/**
 * Recursively lists regular files under `dir`, skipping symlinks, special
 * files and known OS metadata/index files. File extensions are irrelevant:
 * DICOM files are identified later by parsing their content.
 */
export const listCandidateFiles = async (
  dir: string,
  maxDepth: number = archiveLimits.maxPathDepth
): Promise<string[]> => {
  const result: string[] = [];
  const walk = async (current: string, segments: string[]) => {
    if (segments.length > maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entrySegments = [...segments, entry.name];
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isJunkDirectoryName(entry.name)) await walk(full, entrySegments);
      } else if (entry.isFile() && !isJunkPath(entrySegments)) {
        result.push(full);
      }
    }
  };
  await walk(dir, []);
  return result.sort();
};

export interface StoredArchive {
  uploadId: string;
  archivePath: string;
  metadataPath: string;
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * Stores the original uploaded archive byte-for-byte in private storage
 * under an internal name, together with a JSON metadata sidecar.
 * The client file name is intentionally not stored (it may contain PHI).
 */
export const storeOriginalArchive = async (options: {
  sourcePath: string;
  archivesRoot: string;
  /** Directories served publicly; the archive store must not be inside them. */
  publicRoots: string[];
  uploadId: string;
  patientId: string;
  detected: DetectedArchive;
  size: number;
  sha256: string;
}): Promise<StoredArchive> => {
  const { archivesRoot, uploadId, detected } = options;
  if (options.publicRoots.some((root) => isInside(archivesRoot, root))) {
    throw new Error(
      'ARCHIVES_ROOT must not be inside a publicly served directory'
    );
  }
  if (!/^[A-Za-z0-9-]+$/.test(uploadId)) {
    throw new Error('Invalid upload id');
  }
  await mkdir(archivesRoot, { recursive: true, mode: 0o700 });
  const archivePath = path.join(
    archivesRoot,
    `${uploadId}${detected.extension}`
  );
  const metadataPath = path.join(archivesRoot, `${uploadId}.json`);

  await copyFile(options.sourcePath, archivePath, fsConstants.COPYFILE_EXCL);
  try {
    await chmod(archivePath, 0o600);
    const metadata = {
      uploadId,
      patientId: options.patientId,
      format: detected.format,
      extension: detected.extension,
      sizeBytes: options.size,
      sha256: options.sha256,
      storedAt: new Date().toISOString(),
    };
    await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    await rm(archivePath, { force: true });
    // A failed `wx` write may leave a partial sidecar created by this call;
    // EEXIST means the file already existed and is not ours to remove.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await rm(metadataPath, { force: true });
    }
    throw error;
  }
  return { uploadId, archivePath, metadataPath };
};

export const removeStoredArchive = async (stored: StoredArchive) => {
  await rm(stored.archivePath, { force: true });
  await rm(stored.metadataPath, { force: true });
};
