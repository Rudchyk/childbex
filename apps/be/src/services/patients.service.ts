import path from 'path';
import { ImportFileTracker } from './archive/import-file-tracker';
import { logger } from './logger.service';
import {
  brokenImageClusterName,
  clusterByOrientation,
  ClusterResult,
} from './dicom.service';
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
import { PatientImagesCluster } from '../db/models/PatientImagesCluster.model';
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

const toSource = (patientId: string, clusterId: string, name: string) =>
  `/uploads/${patientId}/${clusterId}/${name}`;

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
 * Creates clusters/images for a parsed study inside one DB transaction and
 * places the image files into the uploads directory. The caller must call
 * `tracker.rollback()` if this throws.
 */
const persistClusters = async (
  patientId: string,
  { clusters, broken }: ClusterResult,
  tracker: ImportFileTracker
) => {
  const destDir = path.join(uploadRoot, patientId);
  let imported = 0;
  let alreadyImported = 0;

  await sequelize.transaction(async (transaction) => {
    // Serializes the persistence phase of all imports: the instance
    // deduplication below and the inserts cannot race another import.
    // Taken before any Study/Series/cluster/image write.
    await acquireImportLock(sequelize, transaction);

    const images = [...clusters.flatMap(({ files }) => files), ...broken];
    // Patient -> Study -> Series, in parallel with the clusters (transition).
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
    const seriesIdOf = ({ image }: ParsedDicomMetadata) =>
      (image.studyInstanceUid &&
        image.seriesInstanceUid &&
        hierarchy.seriesIds.get(image.seriesInstanceUid)) ||
      null;

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

    const importGroup = async (
      clusterValues: {
        name: string;
        cluster: number;
        patientId: string;
        notes: string;
        studyDate?: string | null;
      },
      allFiles: {
        file: string;
        row: Omit<PatientImageRow, 'source' | 'clusterId'>;
      }[]
    ) => {
      // Instances already stored keep their row (and cluster) unchanged.
      const files = allFiles.filter(({ file }) => plan.toImport.has(file));
      if (!files.length) return;
      const [imageCluster] = await PatientImagesCluster.findOrCreate({
        where: clusterValues,
        defaults: clusterValues,
        transaction,
      });
      const folder = path.join(destDir, imageCluster.id);
      await tracker.ensureDir(folder);

      const rows: PatientImageRow[] = [];
      for (const { file, row } of files) {
        // The file name is only a storage name (made unique if taken).
        const name = path.basename(file);
        const finalName = await tracker.placeFile(file, folder, name);
        rows.push({
          ...row,
          clusterId: imageCluster.id,
          source: toSource(patientId, imageCluster.id, finalName),
        });
      }
      if (rows.length) {
        await PatientImage.bulkCreate(rows, { transaction });
      }
      imported += rows.length;
    };

    for (const {
      id,
      group,
      files,
      geometry,
      outliers,
      normal,
      studyDate,
    } of clusters) {
      await importGroup(
        {
          name: group || String(id),
          cluster: id,
          patientId,
          studyDate: studyDate ? studyDate.toISOString() : null,
          notes: '',
        },
        files.map(({ file, metadata, fileInfo, positionScalar }) => ({
          file,
          row: {
            details: { geometry, outliers, normal },
            ...toPatientImageDicomMetadata(metadata, fileInfo, positionScalar),
            seriesId: seriesIdOf(metadata),
          },
        }))
      );
    }

    // DICOM images whose pixel data is missing/truncated.
    if (broken.length) {
      await importGroup(
        { name: brokenImageClusterName, cluster: -1, patientId, notes: '' },
        broken.map(({ file, reason, metadata, fileInfo }) => ({
          file,
          row: {
            details: null,
            notes: reason,
            isBrocken: true,
            status: PatientImageStatus.BROKEN,
            // Not part of a cluster: no position along a slice normal.
            ...toPatientImageDicomMetadata(metadata, fileInfo, null),
            seriesId: seriesIdOf(metadata),
          },
        }))
      );
    }
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
 * 2. Parse and cluster DICOM images; reject if none are usable.
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
    const result = await withPhase('cluster', () =>
      clusterByOrientation(candidates)
    );
    const usableImages = result.clusters.reduce(
      (n, c) => n + c.files.length,
      0
    );

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
      clusters: result.clusters.length,
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
        persistClusters(patientId, result, tracker)
      );
      logger.info({ ...summary, ...counts }, 'patient archive imported');
      return {
        importedImages: counts.imported,
        alreadyImported: counts.alreadyImported,
        clusters: result.clusters.length,
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
