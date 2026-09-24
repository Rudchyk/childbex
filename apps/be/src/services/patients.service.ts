import path from 'path';
import { ImportFileTracker } from './archive/import-file-tracker';
import { logger } from './logger.service';
import {
  brokenImageClusterName,
  clusterByOrientation,
  ClusterResult,
} from './dicom.service';
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

const { ARCHIVES_ROOT = './archives', UPLOAD_ROOT = './uploads' } = process.env;

export const uploadRoot = path.resolve(UPLOAD_ROOT);

/** Private storage for original uploaded archives (never served statically). */
export const archivesRoot = path.resolve(ARCHIVES_ROOT);

type PatientImageRow = PatientImageCreationAttributes &
  Partial<Pick<IPatientImage, 'isBrocken' | 'status'>>;

const toSource = (patientId: string, clusterId: string, name: string) =>
  `/uploads/${patientId}/${clusterId}/${name}`;

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
    const importGroup = async (
      clusterValues: {
        name: string;
        cluster: number;
        patientId: string;
        notes: string;
        studyDate?: string | null;
      },
      files: {
        file: string;
        row: Omit<PatientImageRow, 'source' | 'clusterId'>;
      }[]
    ) => {
      const [imageCluster] = await PatientImagesCluster.findOrCreate({
        where: clusterValues,
        defaults: clusterValues,
        transaction,
      });
      const folder = path.join(destDir, imageCluster.id);
      await tracker.ensureDir(folder);

      // Same file re-uploaded into the same cluster: keep the existing image.
      const existing = new Set(
        (
          await PatientImage.findAll({
            attributes: ['source'],
            where: {
              source: files.map(({ file }) =>
                toSource(patientId, imageCluster.id, path.basename(file))
              ),
            },
            transaction,
          })
        ).map((image) => image.source)
      );

      const rows: PatientImageRow[] = [];
      for (const { file, row } of files) {
        const name = path.basename(file);
        if (existing.has(toSource(patientId, imageCluster.id, name))) {
          alreadyImported += 1;
          continue;
        }
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
        files.map(({ file }) => ({
          file,
          row: { details: { geometry, outliers, normal } },
        }))
      );
    }

    // DICOM images whose pixel data is missing/truncated.
    if (broken.length) {
      await importGroup(
        { name: brokenImageClusterName, cluster: -1, patientId, notes: '' },
        broken.map(({ file, reason }) => ({
          file,
          row: {
            details: null,
            notes: reason,
            isBrocken: true,
            status: PatientImageStatus.BROKEN,
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
    const extracted = await extractArchive(
      archivePath,
      `archive${extension}`,
      extractedDir
    );
    const candidates = await listCandidateFiles(extractedDir);
    const result = clusterByOrientation(candidates);
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

    const stored = await storeOriginalArchive({
      sourcePath: archivePath,
      archivesRoot,
      publicRoots: [uploadRoot],
      uploadId,
      patientId,
      detected: extracted,
      size,
      sha256,
    });

    const tracker = new ImportFileTracker();
    try {
      const counts = await persistClusters(patientId, result, tracker);
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
