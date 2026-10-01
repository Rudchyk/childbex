/**
 * Materialized export of a FINALIZED / ARCHIVED dataset snapshot for the ML
 * side (apps/ml `childbex_ml.dataset`):
 *
 *   <output>/manifest.json         canonical JSON, manifest schema v1
 *   <output>/EXPORT_COMPLETE.json  written last; snapshot id, manifest hash
 *   <output>/README-SENSITIVE.txt
 *   <output>/dicom/<patientImageId>.dcm   byte-exact copies (never links)
 *
 * Snapshot membership is read in one read-only REPEATABLE READ transaction;
 * nothing is written to the database. `PatientImage.source` is used only
 * here to read the stored file and never appears in any artifact. Files are
 * copied into a temporary sibling directory (hashing the source while
 * copying, then re-hashing the copy); the manifest and the completion
 * marker are written only when every file succeeded, and the directory is
 * then renamed to `<output>` in one step. Any failure removes the temporary
 * directory: an `<output>` directory never exists half-written.
 *
 * The DICOM files are original bytes and may contain PHI: the export is
 * sensitive medical data (not de-identified).
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { QueryTypes, Transaction } from 'sequelize';
import { DatasetSnapshotStatus } from '@libs/schemas';
import { sequelize } from '../../db/sequelize';
import { DatasetSnapshot } from '../../db/models/DatasetSnapshot.model';
import { archivesRoot as defaultArchivesRoot, uploadRoot as defaultUploadRoot } from '../storage-roots';
import { isInside, resolveStoredFile } from '../stored-file';
import { canonicalJson } from './canonical-json';
import { sha256OfFile } from './file-check';

export const EXPORT_FORMAT_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const SPLIT_ORDER = ['TRAIN', 'VALIDATION', 'TEST'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type DatasetExportErrorCode =
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_NOT_FINALIZED'
  | 'OUTPUT_EXISTS'
  | 'OUTPUT_PARENT_MISSING'
  | 'OUTPUT_INSIDE_STORAGE'
  | 'EXPORT_FILES_FAILED';

export type ExportFileFailureCode =
  | 'MISSING_FILE'
  | 'FILE_SIZE_MISMATCH'
  | 'FILE_HASH_MISMATCH'
  | 'DESTINATION_HASH_MISMATCH';

export interface ExportFileFailure {
  patientImageId: string;
  code: ExportFileFailureCode;
}

export class DatasetExportError extends Error {
  constructor(
    public code: DatasetExportErrorCode,
    message: string,
    public failures: ExportFileFailure[] = []
  ) {
    super(message);
    this.name = 'DatasetExportError';
  }
}

export interface ManifestPatient {
  patientGroupKey: string;
  patientId: string;
  split: string;
  stratum: string;
  imageCount: number;
  normalImages: number;
  abnormalImages: number;
}

export interface ManifestItem {
  patientImageId: string;
  patientGroupKey: string;
  patientId: string;
  studyId: string;
  seriesId: string;
  split: string;
  label: string;
  reviewStateAtSnapshot: string;
  reviewStateSourceAtSnapshot: string;
  seriesOrderIndex: number;
  fileSha256: string;
  fileSize: number;
}

/** Manifest schema v1: only immutable, non-identifying snapshot facts. */
export interface DatasetManifestV1 {
  manifestSchemaVersion: 1;
  snapshot: {
    id: string;
    datasetSchemaVersion: number;
    datasetConfiguration: unknown;
    splitSeed: string;
    finalizedAt: string;
    reviewFreezeId: string | null;
    fileVerification: string | null;
    totalPatients: number;
    totalImages: number;
    normalImages: number;
    abnormalImages: number;
  };
  patients: ManifestPatient[];
  items: ManifestItem[];
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const splitRank = (split: string) => SPLIT_ORDER.indexOf(split as (typeof SPLIT_ORDER)[number]);

/** Canonical order: split (TRAIN, VALIDATION, TEST), then patientGroupKey. */
export const comparePatients = (a: ManifestPatient, b: ManifestPatient) =>
  splitRank(a.split) - splitRank(b.split) || compareText(a.patientGroupKey, b.patientGroupKey);

/** Canonical order: split, patientGroupKey, seriesId, seriesOrderIndex, patientImageId. */
export const compareItems = (a: ManifestItem, b: ManifestItem) =>
  splitRank(a.split) - splitRank(b.split) ||
  compareText(a.patientGroupKey, b.patientGroupKey) ||
  compareText(a.seriesId, b.seriesId) ||
  a.seriesOrderIndex - b.seriesOrderIndex ||
  compareText(a.patientImageId, b.patientImageId);

export const manifestSha256 = (manifest: DatasetManifestV1) =>
  createHash('sha256').update(canonicalJson(manifest), 'utf8').digest('hex');

interface SnapshotRead {
  manifest: DatasetManifestV1;
  status: DatasetSnapshotStatus;
  /** patientImageId -> stored source (internal only). */
  sources: Map<string, string>;
}

type ItemRow = Omit<ManifestItem, 'fileSize'> & { fileSize: string | number; source: string };

/** Reads the frozen membership in one read-only REPEATABLE READ transaction. */
export const readSnapshotForExport = async (snapshotId: string): Promise<SnapshotRead> => {
  if (!UUID.test(snapshotId)) {
    throw new DatasetExportError('SNAPSHOT_NOT_FOUND', 'Dataset snapshot not found.');
  }
  return sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
    async (transaction) => {
      await sequelize.query('SET TRANSACTION READ ONLY', { transaction });
      const snapshot = await DatasetSnapshot.findByPk(snapshotId, { transaction });
      if (!snapshot) throw new DatasetExportError('SNAPSHOT_NOT_FOUND', 'Dataset snapshot not found.');
      if (
        snapshot.status !== DatasetSnapshotStatus.FINALIZED &&
        snapshot.status !== DatasetSnapshotStatus.ARCHIVED
      ) {
        throw new DatasetExportError(
          'SNAPSHOT_NOT_FINALIZED',
          'Only FINALIZED or ARCHIVED snapshots can be exported.'
        );
      }
      const patients = await sequelize.query<ManifestPatient>(
        `SELECT "patientGroupKey", "patientId", split, stratum, "imageCount",
                "normalImages", "abnormalImages"
           FROM dataset_snapshot_patients WHERE "snapshotId" = $1`,
        { bind: [snapshotId], type: QueryTypes.SELECT, transaction }
      );
      const rows = await sequelize.query<ItemRow>(
        `SELECT i."patientImageId", i."patientGroupKey", i."patientId", i."studyId",
                i."seriesId", i.split, i.label, i."reviewStateAtSnapshot",
                i."reviewStateSourceAtSnapshot", i."seriesOrderIndex", i."fileSha256",
                i."fileSize", p.source
           FROM dataset_snapshot_items i
           JOIN patients_images p ON p.id = i."patientImageId"
          WHERE i."snapshotId" = $1`,
        { bind: [snapshotId], type: QueryTypes.SELECT, transaction }
      );

      const sources = new Map<string, string>();
      const items: ManifestItem[] = rows.map(({ source, fileSize, ...item }) => {
        sources.set(item.patientImageId, source);
        return { ...item, seriesOrderIndex: Number(item.seriesOrderIndex), fileSize: Number(fileSize) };
      });
      const manifest: DatasetManifestV1 = {
        manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
        snapshot: {
          id: snapshot.id,
          datasetSchemaVersion: snapshot.datasetSchemaVersion,
          datasetConfiguration: snapshot.configuration,
          splitSeed: snapshot.splitSeed,
          finalizedAt: (snapshot.finalizedAt as Date).toISOString(),
          reviewFreezeId: snapshot.reviewFreezeId,
          fileVerification: snapshot.fileVerification,
          totalPatients: snapshot.totalPatients as number,
          totalImages: snapshot.totalImages as number,
          normalImages: snapshot.normalImages as number,
          abnormalImages: snapshot.abnormalImages as number,
        },
        patients: patients
          .map((patient) => ({
            ...patient,
            imageCount: Number(patient.imageCount),
            normalImages: Number(patient.normalImages),
            abnormalImages: Number(patient.abnormalImages),
          }))
          .sort(comparePatients),
        items: items.sort(compareItems),
      };
      return { manifest, status: snapshot.status, sources };
    }
  );
};

/** Test hooks only (fault injection); never set by the CLI. */
export interface ExportHooks {
  afterCopy?: (tempFile: string, patientImageId: string) => Promise<void>;
  beforeComplete?: () => Promise<void>;
}

export interface ExportOptions {
  uploadRoot?: string;
  archivesRoot?: string;
  onProgress?: (line: string) => void;
  hooks?: ExportHooks;
}

export interface ExportSummary {
  snapshotId: string;
  snapshotStatus: DatasetSnapshotStatus;
  manifestSha256: string;
  itemCount: number;
  totalBytes: number;
}

const SENSITIVE_README = `SENSITIVE MEDICAL DATA - ChildBEx dataset snapshot export

The files in dicom/ are ORIGINAL DICOM files. File names and manifest.json
are free of names, paths and DICOM UIDs, but the DICOM contents may still
contain patient identifying information. This export is NOT de-identified.

Use it only inside the controlled environment. Before a real-patient export
is transferred to Google Colab or any other external or cloud environment,
ChildBEx requires a separate, explicit de-identification / data-governance
decision. Do not upload, sync or share it.
`;

const writeExclusive = async (file: string, text: string) => {
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.datasync();
  } finally {
    await handle.close();
  }
};

/**
 * Streams the stored file into `tempFile` (exclusive create), hashing the
 * source bytes on the way; then re-hashes the written copy.
 */
const copyVerified = async (
  realPath: string,
  tempFile: string,
  expected: { sha256: string; size: number }
): Promise<ExportFileFailureCode | null> => {
  const hash = createHash('sha256');
  let bytes = 0;
  const handle = await open(tempFile, 'wx', 0o600);
  try {
    for await (const chunk of createReadStream(realPath)) {
      hash.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
      await handle.write(chunk as Buffer);
    }
    await handle.datasync();
  } finally {
    await handle.close();
  }
  if (bytes !== expected.size) return 'FILE_SIZE_MISMATCH';
  if (hash.digest('hex') !== expected.sha256) return 'FILE_HASH_MISMATCH';
  return null;
};

const verifyCopy = async (tempFile: string, expected: { sha256: string; size: number }) =>
  (await stat(tempFile)).size === expected.size && (await sha256OfFile(tempFile)) === expected.sha256;

export const checkExportTarget = async (
  output: string,
  roots: { uploadRoot: string; archivesRoot: string }
) => {
  const target = path.resolve(output);
  for (const root of [roots.uploadRoot, roots.archivesRoot]) {
    const resolvedRoot = path.resolve(root);
    if (target === resolvedRoot || isInside(resolvedRoot, target) || isInside(target, resolvedRoot)) {
      throw new DatasetExportError(
        'OUTPUT_INSIDE_STORAGE',
        'The export must not be written inside (or around) the upload or archive storage.'
      );
    }
  }
  if (await stat(target).catch(() => null)) {
    throw new DatasetExportError('OUTPUT_EXISTS', 'The export directory already exists.');
  }
  if (!(await stat(path.dirname(target)).catch(() => null))?.isDirectory()) {
    throw new DatasetExportError('OUTPUT_PARENT_MISSING', 'The parent directory of the export does not exist.');
  }
  return target;
};

export const exportSnapshot = async (
  snapshotId: string,
  output: string,
  {
    uploadRoot = defaultUploadRoot,
    archivesRoot = defaultArchivesRoot,
    onProgress,
    hooks = {},
  }: ExportOptions = {}
): Promise<ExportSummary> => {
  const target = await checkExportTarget(output, { uploadRoot, archivesRoot });
  const { manifest, status, sources } = await readSnapshotForExport(snapshotId);

  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.partial-${randomBytes(8).toString('hex')}`
  );
  await mkdir(temp, { mode: 0o700 });
  try {
    const dicomDir = path.join(temp, 'dicom');
    await mkdir(dicomDir, { mode: 0o700 });

    const failures: ExportFileFailure[] = [];
    let totalBytes = 0;
    for (const [index, item] of manifest.items.entries()) {
      const expected = { sha256: item.fileSha256, size: item.fileSize };
      const finalFile = path.join(dicomDir, `${item.patientImageId}.dcm`);
      const tempFile = `${finalFile}.tmp`;
      const resolved = await resolveStoredFile(sources.get(item.patientImageId) as string, uploadRoot);
      let code: ExportFileFailureCode | null = null;
      if (!resolved.ok) code = 'MISSING_FILE';
      else if (resolved.size !== expected.size) code = 'FILE_SIZE_MISMATCH';
      else {
        code = await copyVerified(resolved.realPath, tempFile, expected);
        if (!code) {
          await hooks.afterCopy?.(tempFile, item.patientImageId);
          if (!(await verifyCopy(tempFile, expected))) code = 'DESTINATION_HASH_MISMATCH';
        }
      }
      if (code) {
        failures.push({ patientImageId: item.patientImageId, code });
        await rm(tempFile, { force: true });
      } else {
        await rename(tempFile, finalFile);
        totalBytes += expected.size;
      }
      if (onProgress && (index + 1) % 500 === 0) {
        onProgress(`copied ${index + 1}/${manifest.items.length} file(s)`);
      }
    }
    if (failures.length) {
      throw new DatasetExportError(
        'EXPORT_FILES_FAILED',
        `${failures.length} file(s) could not be exported; nothing was written.`,
        failures
      );
    }

    const manifestText = canonicalJson(manifest);
    const manifestHash = createHash('sha256').update(manifestText, 'utf8').digest('hex');
    await writeExclusive(path.join(temp, 'manifest.json'), manifestText);
    await writeExclusive(path.join(temp, 'README-SENSITIVE.txt'), SENSITIVE_README);
    await hooks.beforeComplete?.();
    await writeExclusive(
      path.join(temp, 'EXPORT_COMPLETE.json'),
      `${JSON.stringify(
        {
          exportFormatVersion: EXPORT_FORMAT_VERSION,
          manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
          snapshotId: manifest.snapshot.id,
          manifestSha256: manifestHash,
          snapshotStatusAtExport: status,
          itemCount: manifest.items.length,
          totalBytes,
          exportedAt: new Date().toISOString(),
          sensitive: true,
          deidentified: false,
        },
        null,
        2
      )}\n`
    );
    // Re-checked right before the rename (rename onto an existing empty
    // directory would succeed on POSIX).
    if (await stat(target).catch(() => null)) {
      throw new DatasetExportError('OUTPUT_EXISTS', 'The export directory already exists.');
    }
    await rename(temp, target);
    return {
      snapshotId: manifest.snapshot.id,
      snapshotStatus: status,
      manifestSha256: manifestHash,
      itemCount: manifest.items.length,
      totalBytes,
    };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
};
