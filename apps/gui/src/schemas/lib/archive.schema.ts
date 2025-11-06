import { z } from 'zod';

const MAX_SIZE = 500 * 1024 * 1024; // 500 MB
// const ALLOWED_EXT = ['zip', 'tar', 'gz', 'tgz', '7z'];
const ALLOWED_EXT = ['tar', 'gz', 'tgz'] as const;
const ALLOWED_MIME = [
  // 'application/zip',
  'application/x-tar',
  'application/gzip',
  // 'application/x-zip-compressed',
  // 'application/x-compressed',
] as const;

export const ARCHIVE_KEY = 'archive';
export const accept = [...ALLOWED_EXT, ...ALLOWED_MIME].join(',');
export const archiveSchema = z
  .instanceof(File)
  // fileType
  .refine(
    (f) => (f ? ALLOWED_MIME.includes(f.type as any) || f.type === '' : true),
    { message: `Supported only ${ALLOWED_EXT.join(' / ')}` }
  )
  // fileExt
  .refine(
    (f) => {
      if (!f) return true;
      const ext = f.name.toLowerCase().split('.').pop() ?? '';
      return (ALLOWED_EXT as readonly string[]).includes(ext);
    },
    { message: 'Invalid extension' }
  )
  // fileSize
  .refine((f) => (f ? f.size <= MAX_SIZE : true), {
    message: `File to big (≤${Math.floor(MAX_SIZE / 1024 / 1024)} МБ)`,
  });

export type ArchiveSchema = z.infer<typeof archiveSchema>;
