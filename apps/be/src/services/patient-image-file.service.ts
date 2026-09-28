import { open, realpath, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
// Imported before the models: models and patients.service import each other,
// and this order initializes them correctly when this module is loaded first.
import { uploadRoot } from './patients.service';
import { Patient } from '../db/models/Patient.model';
import { PatientImage } from '../db/models/PatientImage.model';
import { PatientImagesCluster } from '../db/models/PatientImagesCluster.model';

/**
 * Prefix of `PatientImage.source`. It is a stored location relative to the
 * upload root, not a served URL: files are only served by the authenticated
 * patient image file API route.
 */
const sourcePrefix = '/uploads/';

const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return (
    !!relative &&
    !path.isAbsolute(relative) &&
    relative.split(path.sep)[0] !== '..'
  );
};

/**
 * Maps a stored `source` to an absolute path inside `root`, or `null` when it
 * would point outside of it (lexical check; symlinks are checked on open).
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

/**
 * Returns the stored `source` of an image that belongs to the patient, or
 * `null`. Images of other patients and of trashed patients (paranoid) are
 * not found.
 */
export const findPatientImageSource = async (
  patientId: string,
  imageId: string
): Promise<string | null> => {
  const image = await PatientImage.findOne({
    where: { id: imageId },
    attributes: ['id', 'source'],
    include: [
      {
        model: PatientImagesCluster,
        as: 'cluster',
        attributes: ['id'],
        required: true,
        where: { patientId },
        include: [
          {
            model: Patient,
            as: 'patient',
            attributes: ['id'],
            required: true,
          },
        ],
      },
    ],
  });
  return image?.source ?? null;
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
  | { ok: false; reason: 'outside_upload_root' | 'missing' | 'not_a_file' };

const isMissingError = (error: unknown) =>
  ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException)?.code ?? '');

/**
 * Opens a stored image file for streaming. The path comes only from the DB
 * and must stay inside the upload root, also after resolving symlinks. Other
 * I/O errors (e.g. too many open files) are thrown, not reported as missing.
 */
export const openUploadFile = async (
  source: string,
  root: string = uploadRoot
): Promise<OpenUploadFileResult> => {
  const candidate = resolveUploadFilePath(source, root);
  if (!candidate) return { ok: false, reason: 'outside_upload_root' };

  let handle: FileHandle;
  try {
    const [realRoot, realFile] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    if (!isInside(realRoot, realFile)) {
      return { ok: false, reason: 'outside_upload_root' };
    }
    handle = await open(realFile, 'r');
  } catch (error) {
    if (isMissingError(error)) return { ok: false, reason: 'missing' };
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
