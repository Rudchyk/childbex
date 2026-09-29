/**
 * DICOM instance identity for the archive import: an image is identified by
 * its SOP Instance UID, and the file SHA-256 tells whether a known UID comes
 * with the same content. File names and clusters are not identity.
 *
 * The decision and the inserts of one import run under one global
 * transaction-level advisory lock, so concurrent imports cannot both insert
 * the same instance (patients_images.sopInstanceUid is not unique yet:
 * databases may hold legacy duplicates).
 */
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

/**
 * Key of the advisory lock that serializes the persistence phase of all
 * archive imports (extraction and parsing run outside of it).
 */
export const IMPORT_PERSISTENCE_LOCK_KEY = 4_352_001;

/** Waits for the import lock; released at the end of `transaction`. */
export const acquireImportLock = async (
  sequelize: Sequelize,
  transaction: Transaction
) => {
  await sequelize.query('SELECT pg_advisory_xact_lock($1::bigint)', {
    bind: [IMPORT_PERSISTENCE_LOCK_KEY],
    transaction,
  });
};

export type InstanceConflictCode =
  | 'SOP_INSTANCE_CONTENT_CONFLICT'
  | 'SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT'
  | 'SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES';

const conflictMessages: Record<InstanceConflictCode, string> = {
  SOP_INSTANCE_CONTENT_CONFLICT:
    'An image of this archive is already stored with different content.',
  SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT:
    'An image of this archive is already stored for another patient.',
  SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES:
    'An image of this archive is already stored in another study or series.',
};

/** Client-safe: no UIDs, file names or paths. */
export class InstanceConflictError extends Error {
  constructor(readonly code: InstanceConflictCode) {
    super(conflictMessages[code]);
    this.name = 'InstanceConflictError';
  }
}

/** One image of the archive being imported. */
export interface IncomingInstance {
  /** Unique within the import (the extracted file). */
  file: string;
  sopInstanceUid: string | null;
  fileSha256: string;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  seriesId: string | null;
}

/** A stored image sharing a SOP Instance UID or a file hash. */
export interface ExistingInstance {
  id: string;
  patientId: string;
  sopInstanceUid: string | null;
  fileSha256: string | null;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  seriesId: string | null;
}

export interface InstancePlan {
  /** Files to store as new images. */
  toImport: Set<string>;
  /** Files that are an instance already stored (or earlier in the archive). */
  alreadyImported: Set<string>;
  /**
   * Stored images with the same file hash but another SOP Instance UID
   * (inconsistent legacy data): imported anyway, only reported.
   */
  possibleDuplicateContent: string[];
}

/** Stored images with any of these SOP Instance UIDs or file hashes. */
export const findExistingInstances = async (
  sequelize: Sequelize,
  instances: IncomingInstance[],
  transaction: Transaction
): Promise<ExistingInstance[]> => {
  const sops = [
    ...new Set(
      instances
        .map(({ sopInstanceUid }) => sopInstanceUid)
        .filter((sop): sop is string => !!sop)
    ),
  ];
  const hashes = [...new Set(instances.map(({ fileSha256 }) => fileSha256))];
  if (!sops.length && !hashes.length) return [];
  // All patients, also those in the trash.
  return sequelize.query<ExistingInstance>(
    `SELECT i.id, c."patientId", i."sopInstanceUid", i."fileSha256",
            i."studyInstanceUid", i."seriesInstanceUid", i."seriesId"
     FROM patients_images i
     JOIN patient_images_clusters c ON c.id = i."clusterId"
     WHERE i."sopInstanceUid" = ANY($1::text[])
        OR i."fileSha256" = ANY($2::text[])`,
    { bind: [sops, hashes], type: QueryTypes.SELECT, transaction }
  );
};

/**
 * Decides per file (pure). Throws `InstanceConflictError`:
 * - same SOP UID stored for another patient -> BELONGS_TO_ANOTHER_PATIENT;
 * - in another study or series -> BELONGS_TO_ANOTHER_SERIES;
 * - with another or an unverified (NULL) hash, or twice in the archive with
 *   different content -> CONTENT_CONFLICT.
 * A SOP UID stored with the same hash in the same patient, study and series
 * (any cluster) is already imported; nothing about the stored row changes.
 */
export const planInstances = (
  patientId: string,
  incoming: IncomingInstance[],
  existing: ExistingInstance[]
): InstancePlan => {
  const plan: InstancePlan = {
    toImport: new Set(),
    alreadyImported: new Set(),
    possibleDuplicateContent: [],
  };
  const storedBySop = new Map<string, ExistingInstance[]>();
  for (const row of existing) {
    if (!row.sopInstanceUid) continue;
    storedBySop.set(row.sopInstanceUid, [
      ...(storedBySop.get(row.sopInstanceUid) ?? []),
      row,
    ]);
  }
  const inArchive = new Map<string, IncomingInstance>();
  const flaggedContent = new Set<string>();

  for (const image of incoming) {
    const sop = image.sopInstanceUid;
    // Same content under another UID: legacy inconsistency, report only.
    for (const row of existing) {
      if (
        row.fileSha256 === image.fileSha256 &&
        row.sopInstanceUid !== sop &&
        !flaggedContent.has(row.id)
      ) {
        flaggedContent.add(row.id);
        plan.possibleDuplicateContent.push(row.id);
      }
    }
    if (!sop) {
      plan.toImport.add(image.file);
      continue;
    }

    const earlier = inArchive.get(sop);
    if (earlier) {
      if (earlier.fileSha256 !== image.fileSha256) {
        throw new InstanceConflictError('SOP_INSTANCE_CONTENT_CONFLICT');
      }
      plan.alreadyImported.add(image.file);
      continue;
    }
    inArchive.set(sop, image);

    const stored = storedBySop.get(sop) ?? [];
    for (const row of stored) {
      if (row.patientId !== patientId) {
        throw new InstanceConflictError('SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT');
      }
      if (
        row.studyInstanceUid !== image.studyInstanceUid ||
        row.seriesInstanceUid !== image.seriesInstanceUid ||
        (row.seriesId !== null &&
          image.seriesId !== null &&
          row.seriesId !== image.seriesId)
      ) {
        throw new InstanceConflictError('SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES');
      }
      // A NULL hash cannot prove the stored file is the same one.
      if (row.fileSha256 !== image.fileSha256) {
        throw new InstanceConflictError('SOP_INSTANCE_CONTENT_CONFLICT');
      }
    }
    if (stored.length) plan.alreadyImported.add(image.file);
    else plan.toImport.add(image.file);
  }
  plan.possibleDuplicateContent.sort();
  return plan;
};
