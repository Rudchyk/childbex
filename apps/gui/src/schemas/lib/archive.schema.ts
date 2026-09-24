import { z } from 'zod';
import { ARCHIVE_EXTENSIONS, ARCHIVE_MAX_UPLOAD_BYTES } from '@libs/constants';

const MAX_SIZE = ARCHIVE_MAX_UPLOAD_BYTES;

export const ARCHIVE_KEY = 'archive';
// Browsers match `accept` by the last extension, so also list the plain
// compression suffixes; the full name is validated below and on the server.
export const accept = [
  ...new Set([...ARCHIVE_EXTENSIONS, '.gz', '.bz2', '.xz']),
].join(',');
export const archiveSchema = z
  .instanceof(File)
  // fileExt (MIME types are not checked: browsers report them inconsistently
  // for archives; the server validates the actual archive content)
  .refine(
    (f) => {
      if (!f) return true;
      const name = f.name.toLowerCase();
      return ARCHIVE_EXTENSIONS.some(
        (ext) => name.endsWith(ext) && name.length > ext.length
      );
    },
    { message: `Supported only ${ARCHIVE_EXTENSIONS.join(' / ')}` }
  )
  // fileSize
  .refine((f) => (f ? f.size <= MAX_SIZE : true), {
    message: `File to big (≤${Math.floor(MAX_SIZE / 1024 / 1024)} МБ)`,
  });

export type ArchiveSchema = z.infer<typeof archiveSchema>;
