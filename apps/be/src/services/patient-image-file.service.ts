import { open, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
// Imported before the models: models and patients.service import each other,
// and this order initializes them correctly when this module is loaded first.
import { uploadRoot } from './patients.service';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../db/sequelize';
import { resolveStoredFile, type StoredFileProblem } from './stored-file';

export { resolveUploadFilePath } from './stored-file';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the stored `source` of an image that belongs to the patient
 * (image -> Series -> Study -> Patient), or `null`. Images of other
 * patients, unknown images and images of trashed patients are not found
 * alike. `source` is only where the file is stored.
 */
export const findPatientImageSource = async (
  patientId: string,
  imageId: string
): Promise<string | null> => {
  if (!UUID.test(patientId) || !UUID.test(imageId)) return null;
  const [row] = await sequelize.query<{ source: string }>(
    `SELECT i.source FROM patients_images i
     JOIN series se ON se.id = i."seriesId"
     JOIN studies s ON s.id = se."studyId"
     JOIN patients p ON p.id = s."patientId" AND p."deletedAt" IS NULL
     WHERE i.id = :imageId AND p.id = :patientId`,
    { replacements: { patientId, imageId }, type: QueryTypes.SELECT }
  );
  return row?.source ?? null;
};

/**
 * Exposes a Node stream as a web `ReadableStream`, the body type of the fets
 * `Response`. Pull-based: the next chunk is read only when the client has
 * taken the previous one, so a file is never buffered in memory as a whole.
 * Cancelling (e.g. the client aborted the request) destroys the source,
 * which closes the file.
 */
export const toWebStream = (source: Readable): ReadableStream<Uint8Array> => {
  const chunks = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      source.destroy();
    },
  });
};

export type OpenUploadFileResult =
  | { ok: true; stream: ReadableStream<Uint8Array>; size: number }
  | { ok: false; reason: StoredFileProblem };

/**
 * Opens a stored image file for streaming. The path comes only from the DB
 * and must stay inside the upload root, also after resolving symlinks. Other
 * I/O errors (e.g. too many open files) are thrown, not reported as missing.
 */
export const openUploadFile = async (
  source: string,
  root: string = uploadRoot
): Promise<OpenUploadFileResult> => {
  const resolved = await resolveStoredFile(source, root);
  if (!resolved.ok) return resolved;

  let handle: FileHandle;
  try {
    handle = await open(resolved.realPath, 'r');
  } catch (error) {
    // Removed after it was resolved.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, reason: 'missing' };
    }
    throw error;
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      await handle.close();
      return { ok: false, reason: 'not_a_file' };
    }
    // The read stream owns the handle and closes it when it ends or is
    // destroyed (also when the client aborts the request).
    return {
      ok: true,
      stream: toWebStream(handle.createReadStream()),
      size: stats.size,
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
};
