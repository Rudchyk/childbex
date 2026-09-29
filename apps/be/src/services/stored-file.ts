import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { uploadRoot } from './storage-roots';

/**
 * Prefix of `PatientImage.source`. It is a stored location relative to the
 * upload root, not a served URL: files are only served by the authenticated
 * patient image file API route.
 */
const sourcePrefix = '/uploads/';

export const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    !!relative &&
    !path.isAbsolute(relative) &&
    relative.split(path.sep)[0] !== '..'
  );
};

/**
 * Maps a stored `source` to an absolute path inside `root`, or `null` when it
 * would point outside of it (lexical check; symlinks are checked by
 * `resolveStoredFile`).
 */
export const resolveUploadFilePath = (
  source: string,
  root: string = uploadRoot
): string | null => {
  if (!source.startsWith(sourcePrefix)) return null;
  const relative = source.slice(sourcePrefix.length);
  if (!relative || relative.includes('\0')) return null;
  const resolved = path.resolve(root, relative);
  return isInside(root, resolved) ? resolved : null;
};

export type StoredFileProblem = 'outside_upload_root' | 'missing' | 'not_a_file';

export type ResolvedStoredFile =
  | {
      ok: true;
      /** Real path (symlinks resolved); never log or report it. */
      realPath: string;
      size: number;
      /** `dev:ino`: identifies one physical file, also across hard links. */
      fileId: string;
    }
  | { ok: false; reason: StoredFileProblem };

const isMissingError = (error: unknown) =>
  ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');

/**
 * Resolves a stored `source` (taken only from the DB) to a regular file that
 * stays inside the upload root, also after resolving symlinks. Other I/O
 * errors (e.g. too many open files) are thrown, not reported as missing.
 */
export const resolveStoredFile = async (
  source: string,
  root: string = uploadRoot
): Promise<ResolvedStoredFile> => {
  const candidate = resolveUploadFilePath(source, root);
  if (!candidate) return { ok: false, reason: 'outside_upload_root' };
  try {
    const [realRoot, realFile] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    if (!isInside(realRoot, realFile)) {
      return { ok: false, reason: 'outside_upload_root' };
    }
    // bigint: inode numbers (e.g. on NTFS) can exceed 2^53.
    const stats = await stat(realFile, { bigint: true });
    if (!stats.isFile()) return { ok: false, reason: 'not_a_file' };
    return {
      ok: true,
      realPath: realFile,
      size: Number(stats.size),
      fileId: `${stats.dev}:${stats.ino}`,
    };
  } catch (error) {
    if (isMissingError(error)) return { ok: false, reason: 'missing' };
    throw error;
  }
};
