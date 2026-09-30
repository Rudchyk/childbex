/**
 * Audit and conservative cleanup of legacy duplicate SOP Instance UIDs in
 * `patients_images` (maintenance command; dry-run unless `apply`).
 *
 * A group is all rows with one non-null SOP Instance UID (size > 1), across
 * all patients (also trashed ones). Only SAFE_IDENTICAL groups are cleaned:
 * the canonical row is kept exactly as it is, duplicates without any review
 * data are deleted (raw SQL: no model hooks), then their files are removed.
 * Nothing is merged: review data on two or more rows is a REVIEW_CONFLICT.
 *
 * Every mutated group is fully revalidated under the import lock (PR4.1)
 * with its rows locked (FOR UPDATE): rows, review data, classification and
 * file hashes are read again; anything different from the scan aborts the
 * group without changes. Files are deleted only after the commit: a failure
 * leaves an extra file (reported), never a row without its image.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import { patientImageDicomMetadataAttributes } from '../../services/dicom.metadata';
import { acquireImportLock } from '../../services/instance-dedup.service';
import {
  resolveStoredFile,
  resolveUploadFilePath,
} from '../../services/stored-file';
import { reportKey } from '../backfill/dicom-metadata.backfill';
import { checkPreconditions } from '../backfill/study-series.backfill';

export type DuplicateClass =
  | 'OWNER_CONFLICT'
  | 'STUDY_SERIES_CONFLICT'
  | 'UNVERIFIED'
  | 'CONTENT_CONFLICT'
  | 'METADATA_CONFLICT'
  | 'FILE_PROBLEM'
  | 'REVIEW_CONFLICT'
  | 'SAFE_IDENTICAL';

/** One row of a duplicate group, with what the classification needs. */
export interface DuplicateRow {
  id: string;
  patientId: string;
  clusterId: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  seriesId: string | null;
  status: string;
  notes: string | null;
  isBrocken: boolean;
  votesCount: number;
  adminResolutionId: string | null;
  adminResolutionName: string | null;
  resolutionComment: string | null;
  resolvedAt: Date | null;
  /** Rows in patient_image_review_votes. */
  voteRows: number;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  fileSha256: string | null;
  [metadata: string]: unknown;
}

export type FileProblem =
  | 'missing'
  | 'unsafe_path'
  | 'not_a_file'
  | 'hash_mismatch'
  | 'read_failed';

export type FileCheck =
  | {
      ok: true;
      realPath: string;
      /** `dev:ino` of the file. */
      fileId: string;
      /** No symlink / junction on the stored path (safe to unlink). */
      plainPath: boolean;
    }
  | { ok: false; problem: FileProblem };

export interface Classification {
  classification: DuplicateClass;
  /** Technical reasons (field names, problem codes): no values. */
  reasons: string[];
  /** SAFE_IDENTICAL only. */
  canonicalId?: string;
  duplicateIds?: string[];
}

// --- Classification (pure) ---------------------------------------------------

const distinct = (values: unknown[]) =>
  new Set(values.map((value) => JSON.stringify(value ?? null))).size;

/** Metadata that must be identical for one instance (slicePosition depends on the cluster). */
const comparedMetadata = patientImageDicomMetadataAttributes.filter(
  (attribute) => attribute !== 'slicePosition'
);

/**
 * Review data on a row: votes, vote counters, an admin resolution, a status
 * beyond not_reviewed/broken, or notes (broken rows' notes are a technical
 * reason, not a review).
 */
export const hasReviewData = (row: DuplicateRow) =>
  row.voteRows > 0 ||
  row.votesCount > 0 ||
  row.adminResolutionId !== null ||
  row.adminResolutionName !== null ||
  row.resolutionComment !== null ||
  row.resolvedAt !== null ||
  !['not_reviewed', 'broken'].includes(row.status) ||
  (!row.isBrocken && !!row.notes?.trim());

/** Checks 1-5 (no files needed); null when they all pass. */
export const classifyRows = (rows: DuplicateRow[]): Classification | null => {
  if (distinct(rows.map((r) => r.patientId)) > 1) {
    return { classification: 'OWNER_CONFLICT', reasons: ['patientId'] };
  }
  const hierarchy = ['studyInstanceUid', 'seriesInstanceUid'].filter(
    (field) => distinct(rows.map((r) => r[field])) > 1
  );
  const linked = rows.map((r) => r.seriesId).filter((id) => id !== null);
  if (distinct(linked) > 1) hierarchy.push('seriesId');
  if (hierarchy.length) {
    return { classification: 'STUDY_SERIES_CONFLICT', reasons: hierarchy };
  }
  if (rows.some((r) => r.fileSha256 === null)) {
    return { classification: 'UNVERIFIED', reasons: ['fileSha256'] };
  }
  if (distinct(rows.map((r) => r.fileSha256)) > 1) {
    return { classification: 'CONTENT_CONFLICT', reasons: ['fileSha256'] };
  }
  const differing = comparedMetadata.filter((attribute) => {
    // int8 comes back as a string.
    const values = rows.map((r) =>
      attribute === 'fileSize' && r[attribute] !== null
        ? Number(r[attribute])
        : r[attribute]
    );
    return distinct(values) > 1;
  });
  if (differing.length) {
    return { classification: 'METADATA_CONFLICT', reasons: differing };
  }
  return null;
};

/** Canonical row: the reviewed one, else the oldest, else the smallest id. */
export const chooseCanonical = (rows: DuplicateRow[]) =>
  [...rows].sort(
    (a, b) =>
      Number(hasReviewData(b)) - Number(hasReviewData(a)) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )[0];

/** Full classification (checks 1-8), given the file checks of all rows. */
export const classifyGroup = (
  rows: DuplicateRow[],
  files: Map<string, FileCheck>
): Classification => {
  const early = classifyRows(rows);
  if (early) return early;
  const fileProblems = rows
    .map((row) => files.get(row.id))
    .flatMap((check) => (check && !check.ok ? [check.problem] : []));
  if (fileProblems.length || files.size < rows.length) {
    return {
      classification: 'FILE_PROBLEM',
      reasons: [...new Set(fileProblems)].sort(),
    };
  }
  if (rows.filter(hasReviewData).length > 1) {
    return { classification: 'REVIEW_CONFLICT', reasons: ['review_data'] };
  }
  const canonical = chooseCanonical(rows);
  return {
    classification: 'SAFE_IDENTICAL',
    reasons: [],
    canonicalId: canonical.id,
    duplicateIds: rows
      .filter(({ id }) => id !== canonical.id)
      .map(({ id }) => id)
      .sort(),
  };
};

// --- Database and files ------------------------------------------------------

const metadataSelect = patientImageDicomMetadataAttributes
  .map((attribute) => `i."${attribute}"`)
  .join(', ');

const loadGroupRows = (
  sequelize: Sequelize,
  sopInstanceUid: string,
  transaction?: Transaction
) =>
  sequelize.query<DuplicateRow>(
    `SELECT i.id, c."patientId", i."clusterId", i.source, i."createdAt",
            i."updatedAt", i."seriesId", i.status, i.notes, i."isBrocken",
            i."votesCount", i."adminResolutionId", i."adminResolutionName",
            i."resolutionComment", i."resolvedAt",
            (SELECT count(*) FROM patient_image_review_votes v
             WHERE v."patientImageId" = i.id)::int AS "voteRows",
            ${metadataSelect}
     FROM patients_images i
     JOIN patient_images_clusters c ON c.id = i."clusterId"
     WHERE i."sopInstanceUid" = $1
     ORDER BY i.id`,
    { bind: [sopInstanceUid], type: QueryTypes.SELECT, transaction }
  );

const hashFile = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

/** Resolves (safely, as the file route) and hashes every row's file. */
export const checkFiles = async (
  rows: DuplicateRow[],
  uploadRoot: string
): Promise<Map<string, FileCheck>> => {
  const checks = new Map<string, FileCheck>();
  const realRoot = await realpath(uploadRoot);
  for (const row of rows) {
    try {
      const file = await resolveStoredFile(row.source, uploadRoot);
      if (!file.ok) {
        checks.set(row.id, {
          ok: false,
          problem:
            file.reason === 'missing'
              ? 'missing'
              : file.reason === 'not_a_file'
              ? 'not_a_file'
              : 'unsafe_path',
        });
        continue;
      }
      if ((await hashFile(file.realPath)) !== row.fileSha256) {
        checks.set(row.id, { ok: false, problem: 'hash_mismatch' });
        continue;
      }
      const lexical = resolveUploadFilePath(row.source, uploadRoot) as string;
      checks.set(row.id, {
        ok: true,
        realPath: file.realPath,
        fileId: file.fileId,
        plainPath:
          file.realPath ===
          path.resolve(realRoot, path.relative(uploadRoot, lexical)),
      });
    } catch {
      checks.set(row.id, { ok: false, problem: 'read_failed' });
    }
  }
  return checks;
};

/** What decides a group; any difference aborts an apply. */
const fingerprint = (rows: DuplicateRow[]) =>
  JSON.stringify(
    rows.map((row) => [
      row.id,
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt,
      row.voteRows,
      hasReviewData(row),
      row.fileSha256,
      row.patientId,
      row.seriesId,
    ])
  );

// --- Run ---------------------------------------------------------------------

export interface DuplicateSopCleanupOptions {
  apply: boolean;
  /** Only this group (`k-...` key from a report); a selector, never a force. */
  group: string | null;
  uploadRoot: string;
  hmacKey: string;
  onProgress?: (line: string) => void;
  /** File removal (injectable for tests). */
  removeFile?: (file: string) => Promise<void>;
}

export type FileAction =
  | 'file_removed'
  /** Hard link of the canonical file: only this name was removed. */
  | 'hardlink_name_removed'
  /** Stored path goes through a symlink or is the canonical file: kept. */
  | 'file_kept'
  | 'file_delete_failed';

export interface DuplicateGroupReport {
  key: string;
  classification: DuplicateClass;
  reasons: string[];
  patientIds: string[];
  imageIds: string[];
  canonicalImageId: string | null;
  duplicateImageIds: string[];
  /**
   * dry-run: would_clean / none; apply: cleaned / none /
   * changed_during_run (revalidation differs: nothing changed) / failed
   * (error, rolled back: nothing changed).
   */
  action: 'would_clean' | 'cleaned' | 'none' | 'changed_during_run' | 'failed';
  fileActions: { imageId: string; action: FileAction }[];
}

export interface DuplicateSopReport {
  run: {
    mode: 'dry-run' | 'apply';
    startedAt: string;
    finishedAt: string;
    options: { group: string | null };
  };
  summary: Record<string, number>;
  groups: DuplicateGroupReport[];
  /** Clusters left without images by this run (not deleted). */
  emptyClusters: string[];
}

const report = (
  key: string,
  rows: DuplicateRow[],
  result: Classification
): DuplicateGroupReport => ({
  key,
  classification: result.classification,
  reasons: result.reasons,
  patientIds: [...new Set(rows.map((r) => r.patientId))].sort(),
  imageIds: rows.map((r) => r.id).sort(),
  canonicalImageId: result.canonicalId ?? null,
  duplicateImageIds: result.duplicateIds ?? [],
  action: 'none',
  fileActions: [],
});

const classifyWithFiles = async (rows: DuplicateRow[], uploadRoot: string) => {
  if (classifyRows(rows))
    return { result: classifyGroup(rows, new Map()), files: new Map() };
  const files = await checkFiles(rows, uploadRoot);
  return { result: classifyGroup(rows, files), files };
};

export const runDuplicateSopCleanup = async (
  sequelize: Sequelize,
  options: DuplicateSopCleanupOptions
): Promise<DuplicateSopReport> => {
  const startedAt = new Date().toISOString();
  // Runs before the unique SOP index (it resolves what blocks it).
  await checkPreconditions(
    sequelize,
    options,
    '202609301200-patient-image-instance-indexes'
  );
  const progress = options.onProgress ?? (() => undefined);
  const removeFile = options.removeFile ?? unlink;

  const sops = (
    await sequelize.query<{ sop: string }>(
      `SELECT "sopInstanceUid" AS sop FROM patients_images
       WHERE "sopInstanceUid" IS NOT NULL
       GROUP BY "sopInstanceUid" HAVING count(*) > 1
       ORDER BY "sopInstanceUid"`,
      { type: QueryTypes.SELECT }
    )
  )
    .map(({ sop }) => ({ sop, key: reportKey(options.hmacKey, 'sop', sop) }))
    .filter(({ key }) => !options.group || key === options.group);

  const groups: DuplicateGroupReport[] = [];
  const touchedClusters = new Set<string>();
  for (const { sop, key } of sops) {
    const scannedRows = await loadGroupRows(sequelize, sop);
    const scanned = await classifyWithFiles(scannedRows, options.uploadRoot);
    const group = report(key, scannedRows, scanned.result);
    groups.push(group);
    if (scanned.result.classification !== 'SAFE_IDENTICAL') continue;
    if (!options.apply) {
      group.action = 'would_clean';
      continue;
    }

    // Apply: revalidate everything under the import lock with rows locked.
    let deleted: DuplicateRow[] = [];
    let canonicalFile: FileCheck | undefined;
    let files = new Map<string, FileCheck>();
    try {
      await sequelize.transaction(async (transaction) => {
        await acquireImportLock(sequelize, transaction);
        await sequelize.query(
          `SELECT id FROM patients_images WHERE "sopInstanceUid" = $1 FOR UPDATE`,
          { bind: [sop], transaction }
        );
        const rows = await loadGroupRows(sequelize, sop, transaction);
        const current = await classifyWithFiles(rows, options.uploadRoot);
        files = current.files;
        if (
          current.result.classification !== 'SAFE_IDENTICAL' ||
          fingerprint(rows) !== fingerprint(scannedRows) ||
          current.result.canonicalId !== scanned.result.canonicalId
        ) {
          Object.assign(group, report(key, rows, current.result), {
            action: 'changed_during_run',
          });
          return;
        }
        const duplicateIds = current.result.duplicateIds as string[];
        // Never delete a row with votes (guard in the statement itself).
        const removed = await sequelize.query<{ id: string }>(
          `DELETE FROM patients_images i
         WHERE i.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM patient_image_review_votes v
                           WHERE v."patientImageId" = i.id)
         RETURNING i.id`,
          { bind: [duplicateIds], type: QueryTypes.SELECT, transaction }
        );
        if (removed.length !== duplicateIds.length) {
          throw new Error('Duplicate rows changed while being deleted.');
        }
        deleted = rows.filter(({ id }) => duplicateIds.includes(id));
        canonicalFile = files.get(current.result.canonicalId as string);
        group.action = 'cleaned';
      });
    } catch {
      // Rolled back: this group is unchanged; continue with the others.
      deleted = [];
      group.action = 'failed';
    }

    // After the commit: remove the duplicates' own files.
    for (const row of deleted) {
      touchedClusters.add(row.clusterId);
      const file = files.get(row.id) as FileCheck;
      const canonical = canonicalFile as FileCheck;
      if (
        !file.ok ||
        !canonical.ok ||
        !file.plainPath ||
        file.realPath === canonical.realPath
      ) {
        group.fileActions.push({ imageId: row.id, action: 'file_kept' });
        continue;
      }
      try {
        await removeFile(file.realPath);
        group.fileActions.push({
          imageId: row.id,
          action:
            file.fileId === canonical.fileId
              ? 'hardlink_name_removed'
              : 'file_removed',
        });
      } catch {
        group.fileActions.push({
          imageId: row.id,
          action: 'file_delete_failed',
        });
      }
    }
    progress(`group ${groups.length}/${sops.length}: ${group.action}`);
  }

  const emptyClusters = touchedClusters.size
    ? (
        await sequelize.query<{ id: string }>(
          `SELECT c.id FROM patient_images_clusters c
           WHERE c.id = ANY($1::uuid[])
             AND NOT EXISTS (SELECT 1 FROM patients_images i WHERE i."clusterId" = c.id)
           ORDER BY c.id`,
          { bind: [[...touchedClusters]], type: QueryTypes.SELECT }
        )
      ).map(({ id }) => id)
    : [];

  const byClass = (classification: DuplicateClass) =>
    groups.filter((g) => g.classification === classification).length;
  const byAction = (action: DuplicateGroupReport['action']) =>
    groups.filter((g) => g.action === action);
  const fileActionCount = (action: FileAction) =>
    groups.flatMap((g) => g.fileActions).filter((f) => f.action === action)
      .length;

  return {
    run: {
      mode: options.apply ? 'apply' : 'dry-run',
      startedAt,
      finishedAt: new Date().toISOString(),
      options: { group: options.group },
    },
    summary: {
      duplicateGroups: groups.length,
      safeIdentical: byClass('SAFE_IDENTICAL'),
      ownerConflict: byClass('OWNER_CONFLICT'),
      studySeriesConflict: byClass('STUDY_SERIES_CONFLICT'),
      unverified: byClass('UNVERIFIED'),
      contentConflict: byClass('CONTENT_CONFLICT'),
      metadataConflict: byClass('METADATA_CONFLICT'),
      fileProblem: byClass('FILE_PROBLEM'),
      reviewConflict: byClass('REVIEW_CONFLICT'),
      rowsToDelete: byAction('would_clean').flatMap((g) => g.duplicateImageIds)
        .length,
      rowsDeleted: byAction('cleaned').flatMap((g) => g.duplicateImageIds)
        .length,
      canonicalRowsPreserved: [
        ...byAction('would_clean'),
        ...byAction('cleaned'),
      ].length,
      changedDuringRun: byAction('changed_during_run').length,
      failedGroups: byAction('failed').length,
      filesRemoved: fileActionCount('file_removed'),
      hardlinkNamesRemoved: fileActionCount('hardlink_name_removed'),
      filesKept: fileActionCount('file_kept'),
      fileDeleteFailed: fileActionCount('file_delete_failed'),
      emptyClusters: emptyClusters.length,
    },
    groups,
    emptyClusters,
  };
};
