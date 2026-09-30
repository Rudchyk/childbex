/**
 * File checks of dataset snapshot images. The file is always resolved with
 * the safe resolver (inside the upload root, symlinks resolved).
 *
 * - `size`: the file exists and has the recorded size (preview).
 * - `sha256`: additionally streams the bytes through SHA-256 and compares
 *   them with the recorded hash (finalization, always). One file at a
 *   time, never loaded into memory as a whole.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { DatasetExclusionReason as Reason } from '@libs/schemas';
import { resolveStoredFile } from '../stored-file';

export type FileCheckMode = 'size' | 'sha256';

export const sha256OfFile = async (realPath: string) => {
  const hash = createHash('sha256');
  await pipeline(createReadStream(realPath), hash);
  return hash.digest('hex');
};

/** null when the file passes, else the exclusion reason. */
export const checkImageFile = async (
  { source, fileSize, fileSha256 }: { source: string; fileSize: string | number | null; fileSha256: string },
  mode: FileCheckMode,
  uploadRoot: string
): Promise<Reason | null> => {
  const file = await resolveStoredFile(source, uploadRoot);
  if (!file.ok) return Reason.MISSING_FILE;
  if (fileSize === null || Number(fileSize) !== file.size) {
    return Reason.FILE_SIZE_MISMATCH;
  }
  if (mode === 'sha256' && (await sha256OfFile(file.realPath)) !== fileSha256) {
    return Reason.FILE_HASH_MISMATCH;
  }
  return null;
};
