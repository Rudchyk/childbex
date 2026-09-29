import path from 'node:path';

const { ARCHIVES_ROOT = './archives', UPLOAD_ROOT = './uploads' } = process.env;

/** Stored image files (`PatientImage.source` is relative to it). */
export const uploadRoot = path.resolve(UPLOAD_ROOT);

/** Private storage for original uploaded archives (never served statically). */
export const archivesRoot = path.resolve(ARCHIVES_ROOT);
