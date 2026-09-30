import path from 'path';
import { ImportFileTracker } from './archive/import-file-tracker';
import { logger } from './logger.service';
import { randomUUID } from 'node:crypto';
import { parseArchiveFiles, type ParsedArchive } from './dicom.service';
import {
  toPatientImageDicomMetadata,
  type ParsedDicomMetadata,
} from './dicom.metadata';
import {
  HierarchyConflictError,
  linkPatientHierarchy,
  type HierarchyImage,
} from './dicom-hierarchy.service';
import {
  acquireImportLock,
  findExistingInstances,
  InstanceConflictError,
  planInstances,
  type IncomingInstance,
  type InstancePlan,
} from './instance-dedup.service';
import {
  PatientImage,
  PatientImageCreationAttributes,
} from '../db/models/PatientImage.model';
import { sequelize } from '../db/sequelize';
import type { ArchiveExtension } from '@libs/constants';
import {
  PatientImage as IPatientImage,
  PatientImageStatus,
  type UploadSessionResult,
} from '@libs/schemas';
import {
  ArchiveError,
  extractArchive,
  listCandidateFiles,
  removeStoredArchive,
  storeOriginalArchive,
  withUploadWorkspace,
} from './archive/archive.service';
import { withPhase } from './diagnostics/event-loop.diagnostics';

import { archivesRoot, uploadRoot } from './storage-roots';

export { archivesRoot, uploadRoot };

type PatientImageRow = PatientImageCreationAttributes &
  Partial<Pick<IPatientImage, 'isBrocken' | 'status'>>;

/**
 * Storage location of a new image: database UUIDs only (no original file
 * name, no DICOM UID). Files imported earlier keep their stored `source`.
 */
const toSource = (patientId: string, seriesId: string, imageId: string) =>
  `/uploads/${patientId}/${seriesId}/${imageId}.dcm`;

const destDir = (patientId: string) => path.join(uploadRoot, patientId);

const toHierarchyImage = ({
  image,
  fileOnly,
}: ParsedDicomMetadata): HierarchyImage => ({
  studyInstanceUid: image.studyInstanceUid,
  seriesInstanceUid: image.seriesInstanceUid,
  studyDate: fileOnly.studyDate,
  studyTime: fileOnly.studyTime,
  seriesNumber: image.seriesNumber,
  seriesDescription: image.seriesDescription,
  modality: image.modality,
  imageType: image.imageType,
  frameOfReferenceUid: image.frameOfReferenceUid,
  convolutionKernel: image.convolutionKernel,
  sliceThickness: image.sliceThickness,
});

/**
 * Creates the images of a parsed archive under their DICOM Series inside one
 * DB transaction and places their files into the uploads directory. The
 * caller must call `tracker.rollback()` if this throws.
 */
const persistImages = async (
  patientId: string,
  { images: validImages, broken }: ParsedArchive,
  tracker: ImportFileTracker
) => {
  let imported = 0;
  let alreadyImported = 0;

  await sequelize.transaction(async (transaction) => {
    // Serializes the persistence phase of all imports: the instance
    // deduplication below and the inserts cannot race another import.
    // Taken before any Study/Series/image write.
    await acquireImportLock(sequelize, transaction);

    const images = [...validImages, ...broken];
    // Patient -> Study -> Series.
    const hierarchy = await linkPatientHierarchy(
      sequelize,
      patientId,
      images.map(({ metadata }) => toHierarchyImage(metadata)),
      transaction
    ).catch((error) => {
      // A study of another patient or a series of another study: reject
      // the whole archive (the transaction rolls back).
      if (error instanceof HierarchyConflictError) {
        throw new ArchiveError(error.code, error.message);
      }
      throw error;
    });
    for (const warning of hierarchy.warnings) {
      // Ids and field names only.
      logger.warn({ patientId, ...warning }, 'DICOM hierarchy values differ');
    }
    /** Every parsed image has Study/Series UIDs, so it has its Series. */
    const seriesIdOf = ({ image }: ParsedDicomMetadata) => {
      const seriesId =
        image.seriesInstanceUid && hierarchy.seriesIds.get(image.seriesInstanceUid);
      if (!seriesId) throw new Error('An imported image has no DICOM Series.');
      return seriesId;
    };

    // DICOM instance identity (SOP Instance UID + file hash), decided before
    // any file is placed: a conflict rejects the archive without leftovers.
    const incoming: IncomingInstance[] = images.map(
      ({ file, metadata, fileInfo }) => ({
        file,
        sopInstanceUid: metadata.image.sopInstanceUid,
        fileSha256: fileInfo.sha256,
        studyInstanceUid: metadata.image.studyInstanceUid,
        seriesInstanceUid: metadata.image.seriesInstanceUid,
        seriesId: seriesIdOf(metadata),
      })
    );
    let plan: InstancePlan;
    try {
      plan = planInstances(
        patientId,
        incoming,
        await findExistingInstances(sequelize, incoming, transaction)
      );
    } catch (error) {
      if (error instanceof InstanceConflictError) {
        throw new ArchiveError(error.code, error.message);
      }
      throw error;
    }
    if (plan.possibleDuplicateContent.length) {
      // Image ids only (no UIDs, hashes or names).
      logger.warn(
        { patientId, storedImageIds: plan.possibleDuplicateContent },
        'possible_duplicate_content: stored images with the same file hash under another SOP Instance UID'
      );
    }
    alreadyImported = plan.alreadyImported.size;

    const rows: PatientImageRow[] = [];
    const place = async (
      file: string,
      metadata: ParsedDicomMetadata,
      row: Omit<PatientImageRow, 'id' | 'source' | 'seriesId'>
    ) => {
      // Instances already stored keep their row unchanged.
      if (!plan.toImport.has(file)) return;
      const id = randomUUID();
      const seriesId = seriesIdOf(metadata);
      const folder = path.join(destDir(patientId), seriesId);
      await tracker.ensureDir(folder);
      await tracker.placeNewFile(file, path.join(folder, `${id}.dcm`));
      rows.push({ ...row, id, seriesId, source: toSource(patientId, seriesId, id) });
    };
    for (const { file, metadata, fileInfo, positionScalar } of validImages) {
      await place(file, metadata, {
        ...toPatientImageDicomMetadata(metadata, fileInfo, positionScalar),
      });
    }
    // DICOM images whose pixel data is missing/truncated.
    for (const { file, reason, metadata, fileInfo } of broken) {
      await place(file, metadata, {
        notes: reason,
        isBrocken: true,
        status: PatientImageStatus.BROKEN,
        ...toPatientImageDicomMetadata(metadata, fileInfo, null),
      });
    }
    if (rows.length) {
      await PatientImage.bulkCreate(rows, { transaction });
    }
    imported = rows.length;
  });

  return { imported, alreadyImported };
};

const countByReason = (items: { reason: string }[]) =>
  items.reduce<Record<string, number>>((acc, { reason }) => {
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

export interface ImportPatientArchiveFileRequest {
  /** Upload session id; also names the stored original archive. */
  uploadId: string;
  patientId: string;
  /** Assembled archive on disk (outside any public directory). */
  archivePath: string;
  /** Allowlisted extension; the content signature is validated against it. */
  extension: ArchiveExtension;
  size: number;
  sha256: string;
}

/**
 * Imports an assembled study archive for a patient.
 *
 * 1. Validate the archive type and extract it safely with limits into an
 *    isolated temporary workspace.
 * 2. Parse the DICOM images; reject if none are usable.
 * 3. Store the original archive byte-for-byte in private storage.
 * 4. Create DB rows and place image files in one transaction; on failure,
 *    roll back and remove every file created by this import.
 *
 * The workspace is always removed. Nothing is written to the DB before
 * the archive has been fully validated and parsed.
 */
export const importPatientArchiveFile = async ({
  uploadId,
  patientId,
  archivePath,
  extension,
  size,
  sha256,
}: ImportPatientArchiveFileRequest): Promise<UploadSessionResult> =>
  withUploadWorkspace(async (workspace) => {
    const extractedDir = path.join(workspace, 'extracted');
    // Only the allowlisted extension is passed on; the client file name is
    // never used. Detection still checks it against the content signature.
    const extracted = await withPhase('extract', () =>
      extractArchive(archivePath, `archive${extension}`, extractedDir)
    );
    const candidates = await withPhase('list', () =>
      listCandidateFiles(extractedDir)
    );
    const result = await withPhase('parse', () =>
      parseArchiveFiles(candidates)
    );
    const usableImages = result.images.length;
    const seriesCount = new Set(
      [...result.images, ...result.broken].map(
        ({ metadata }) => metadata.image.seriesInstanceUid
      )
    ).size;

    // Counts only: no file names (they may contain patient data).
    const summary = {
      uploadId,
      patientId,
      format: extracted.format,
      sizeBytes: size,
      sha256,
      ...extracted.stats,
      candidateFiles: candidates.length,
      usableImages,
      series: seriesCount,
      brokenImages: result.broken.length,
      skippedFiles: countByReason(result.skipped),
    };

    if (!usableImages) {
      logger.warn(summary, 'patient archive rejected: no usable DICOM images');
      throw new ArchiveError(
        'NO_USABLE_DICOM',
        'The archive does not contain any usable DICOM images.'
      );
    }

    const stored = await withPhase('store', () =>
      storeOriginalArchive({
        sourcePath: archivePath,
        archivesRoot,
        publicRoots: [uploadRoot],
        uploadId,
        patientId,
        detected: extracted,
        size,
        sha256,
      })
    );

    const tracker = new ImportFileTracker();
    try {
      const counts = await withPhase('persist', () =>
        persistImages(patientId, result, tracker)
      );
      logger.info({ ...summary, ...counts }, 'patient archive imported');
      return {
        importedImages: counts.imported,
        alreadyImported: counts.alreadyImported,
        series: seriesCount,
        brokenImages: result.broken.length,
        skippedFiles: result.skipped.length,
      };
    } catch (error) {
      await tracker.rollback();
      await removeStoredArchive(stored).catch((e) =>
        logger.error(e, 'import rollback: remove stored archive')
      );
      logger.error(
        { uploadId, patientId },
        'patient archive import rolled back'
      );
      throw error;
    }
  });
