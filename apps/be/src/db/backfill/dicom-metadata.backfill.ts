/**
 * Backfill of the DICOM metadata columns of existing `patients_images` rows
 * from their stored files (maintenance command, never run on startup).
 *
 * - Dry-run unless `apply`; every change is written by a controlled UPDATE
 *   that only fills NULL columns (no hooks, `updatedAt` unchanged).
 * - A row with any conflict (a stored value differing from its file) gets no
 *   update at all: it may no longer describe the same DICOM instance.
 * - Files are read before a batch's transaction is opened.
 * - Reports contain ids, result codes and field names only: no paths, file
 *   names, free text, UIDs or hashes (groups use keyed HMACs instead).
 */
import { createHmac } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { QueryTypes, type Sequelize } from 'sequelize';
import {
  patientImageDicomMetadataAttributes,
  toPatientImageDicomMetadata,
  type DataSetImageMetadata,
  type PatientImageDicomMetadata,
} from '../../services/dicom.metadata';
import {
  parseDicomFile,
  positionAlongNormal,
} from '../../services/dicom.service';
import { resolveStoredFile } from '../../services/stored-file';
import { assertSchemaUpToDate } from '../migrator';

type MetadataAttribute = (typeof patientImageDicomMetadataAttributes)[number];

/** SQL types of the metadata columns (migration 202609281200). */
const columnTypes: Record<MetadataAttribute, string> = {
  studyInstanceUid: 'varchar(64)',
  seriesInstanceUid: 'varchar(64)',
  sopInstanceUid: 'varchar(64)',
  sopClassUid: 'varchar(64)',
  modality: 'varchar(16)',
  imageType: 'text[]',
  seriesNumber: 'integer',
  instanceNumber: 'integer',
  frameOfReferenceUid: 'varchar(64)',
  seriesDescription: 'text',
  convolutionKernel: 'text',
  imagePositionPatient: 'double precision[]',
  imageOrientationPatient: 'double precision[]',
  slicePosition: 'double precision',
  rows: 'integer',
  columns: 'integer',
  pixelSpacing: 'double precision[]',
  sliceThickness: 'double precision',
  rescaleSlope: 'double precision',
  rescaleIntercept: 'double precision',
  photometricInterpretation: 'varchar(16)',
  bitsStored: 'smallint',
  pixelRepresentation: 'smallint',
  numberOfFrames: 'integer',
  transferSyntaxUid: 'varchar(64)',
  fileSha256: 'char(64)',
  fileSize: 'bigint',
};

const UID_FIELDS = [
  'studyInstanceUid',
  'seriesInstanceUid',
  'sopInstanceUid',
  'sopClassUid',
  'frameOfReferenceUid',
  'transferSyntaxUid',
] as const satisfies readonly (keyof DataSetImageMetadata)[];

export const MIN_HMAC_KEY_LENGTH = 32;
export const MAX_BATCH_SIZE = 1000;

export class BackfillPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackfillPreconditionError';
  }
}

export interface BackfillOptions {
  /** Write the changes; otherwise nothing is written (dry-run). */
  apply: boolean;
  batchSize: number;
  /** Also fill images of patients in the trash (they are not restored). */
  includeTrashed: boolean;
  /** Also re-read rows that already have a file SHA-256 (full audit). */
  rescan: boolean;
  uploadRoot: string;
  /** Key for the group identifiers (stable between runs). */
  hmacKey: string;
  /** Progress lines (ids and counters only). */
  onProgress?: (line: string) => void;
}

export type BackfillRowResult =
  | 'would_update'
  | 'updated'
  | 'already_complete'
  | 'metadata_conflict'
  | 'changed_during_run'
  | 'missing_file'
  | 'unsafe_path'
  /** Other I/O error (e.g. permissions); only this row is affected. */
  | 'read_failed'
  | 'parse_failed'
  | 'skipped_trashed_patient';

export interface BackfillRowReport {
  imageId: string;
  patientId: string;
  result: BackfillRowResult;
  /** Fields that are (or would be) filled. */
  filled: MetadataAttribute[];
  /** Fields whose stored value differs from the file (names only). */
  conflicts: MetadataAttribute[];
  /**
   * `missing_study_uid`, `missing_series_uid`, `missing_sop_uid`,
   * `invalid_uid:<field>`, `no_slice_position`.
   */
  flags: string[];
}

export interface BackfillGroup {
  /** `k-<hex>`: keyed HMAC of the shared value (never the value itself). */
  key: string;
  imageIds: string[];
  patientIds: string[];
  /** Duplicate SOP Instance UIDs only: the files differ. */
  differentFileHashes?: boolean;
}

export interface BackfillReport {
  run: {
    mode: 'dry-run' | 'apply';
    startedAt: string;
    finishedAt: string;
    options: { batchSize: number; includeTrashed: boolean; rescan: boolean };
  };
  summary: Record<string, number>;
  rows: BackfillRowReport[];
  groups: {
    duplicateSopInstanceUid: BackfillGroup[];
    sopUidAcrossPatients: BackfillGroup[];
    studyUidAcrossPatients: BackfillGroup[];
    seriesUidAcrossStudies: BackfillGroup[];
    duplicateFileHash: BackfillGroup[];
    fileHashAcrossPatients: BackfillGroup[];
    sameStoredFile: BackfillGroup[];
  };
}

type StoredMetadata = Record<MetadataAttribute, unknown>;

interface ScannedRow extends StoredMetadata {
  id: string;
  source: string;
  details: { normal?: unknown } | null;
  isBrocken: boolean;
  patientId: string;
  trashed: boolean;
}

// --- Comparison -------------------------------------------------------------

/** DB values as JS values comparable with parsed ones (int8 is a string). */
const normalizeStored = (attribute: MetadataAttribute, value: unknown) =>
  value !== null && attribute === 'fileSize' ? Number(value) : value;

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  return a === b;
};

export interface MetadataMerge {
  /** Values to write into currently NULL columns. */
  fill: Partial<PatientImageDicomMetadata>;
  conflicts: MetadataAttribute[];
}

/**
 * Null-only merge: NULL + value -> fill; equal -> nothing; different
 * (including a stored value the file no longer has) -> conflict.
 */
export const mergeMetadata = (
  stored: Partial<StoredMetadata>,
  parsed: PatientImageDicomMetadata
): MetadataMerge => {
  const fill: Record<string, unknown> = {};
  const conflicts: MetadataAttribute[] = [];
  for (const attribute of patientImageDicomMetadataAttributes) {
    const current = normalizeStored(attribute, stored[attribute] ?? null);
    const next = parsed[attribute];
    if (current === null) {
      if (next !== null) fill[attribute] = next;
    } else if (!sameValue(current, next)) {
      conflicts.push(attribute);
    }
  }
  return { fill: fill as Partial<PatientImageDicomMetadata>, conflicts };
};

// --- Groups -----------------------------------------------------------------

interface GroupEntry {
  imageId: string;
  patientId: string;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  sopInstanceUid: string | null;
  fileSha256: string | null;
  fileId: string | null;
}

const groupBy = (entries: GroupEntry[], key: (entry: GroupEntry) => string | null) => {
  const groups = new Map<string, GroupEntry[]>();
  for (const entry of entries) {
    const value = key(entry);
    if (value === null) continue;
    const members = groups.get(value);
    if (members) members.push(entry);
    else groups.set(value, [entry]);
  }
  return groups;
};

const distinct = (values: (string | null)[]) =>
  [...new Set(values.filter((value): value is string => value !== null))].sort();

/**
 * Report identifier of a value (UID, hash): `k-<keyed HMAC>`. Stable for the
 * same key; the value itself cannot be read back from it.
 */
export const reportKey = (hmacKey: string, kind: string, value: string) =>
  `k-${createHmac('sha256', hmacKey)
    .update(`${kind}:${value}`)
    .digest('hex')
    .slice(0, 16)}`;

/** Builds the duplicate / leakage groups (pure; used by tests). */
export const buildGroups = (
  entries: GroupEntry[],
  hmacKey: string
): BackfillReport['groups'] => {
  const toGroup = (
    kind: string,
    value: string,
    members: GroupEntry[]
  ): BackfillGroup => ({
    key: reportKey(hmacKey, kind, value),
    imageIds: members.map(({ imageId }) => imageId).sort(),
    patientIds: distinct(members.map(({ patientId }) => patientId)),
  });
  const sortGroups = (groups: BackfillGroup[]) =>
    groups.sort((a, b) => a.key.localeCompare(b.key));

  const collect = (
    kind: string,
    key: (entry: GroupEntry) => string | null,
    keep: (members: GroupEntry[]) => boolean,
    extra?: (members: GroupEntry[]) => Partial<BackfillGroup>
  ) =>
    sortGroups(
      [...groupBy(entries, key)]
        .filter(([, members]) => keep(members))
        .map(([value, members]) => ({
          ...toGroup(kind, value, members),
          ...extra?.(members),
        }))
    );
  const patients = (members: GroupEntry[]) =>
    distinct(members.map(({ patientId }) => patientId)).length;

  return {
    duplicateSopInstanceUid: collect(
      'sop',
      (e) => e.sopInstanceUid,
      (m) => m.length > 1,
      (m) => ({
        differentFileHashes: distinct(m.map((e) => e.fileSha256)).length > 1,
      })
    ),
    sopUidAcrossPatients: collect(
      'sop',
      (e) => e.sopInstanceUid,
      (m) => patients(m) > 1
    ),
    studyUidAcrossPatients: collect(
      'study',
      (e) => e.studyInstanceUid,
      (m) => patients(m) > 1
    ),
    seriesUidAcrossStudies: collect(
      'series',
      (e) => e.seriesInstanceUid,
      (m) => distinct(m.map((e) => e.studyInstanceUid)).length > 1
    ),
    duplicateFileHash: collect(
      'sha256',
      (e) => e.fileSha256,
      (m) => m.length > 1
    ),
    fileHashAcrossPatients: collect(
      'sha256',
      (e) => e.fileSha256,
      (m) => patients(m) > 1
    ),
    sameStoredFile: collect('file', (e) => e.fileId, (m) => m.length > 1),
  };
};

// --- Run --------------------------------------------------------------------

const quoted = (attribute: string) => `"${attribute}"`;
const metadataSelect = patientImageDicomMetadataAttributes
  .map((attribute) => `i.${quoted(attribute)}`)
  .join(', ');

const checkPreconditions = async (
  sequelize: Sequelize,
  options: BackfillOptions
) => {
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > MAX_BATCH_SIZE
  ) {
    throw new BackfillPreconditionError(
      `The batch size must be an integer from 1 to ${MAX_BATCH_SIZE}.`
    );
  }
  if (options.hmacKey.length < MIN_HMAC_KEY_LENGTH) {
    throw new BackfillPreconditionError(
      `REPORT_HMAC_KEY must be set (at least ${MIN_HMAC_KEY_LENGTH} characters).`
    );
  }
  const root = await stat(options.uploadRoot).catch(() => null);
  if (!root?.isDirectory()) {
    throw new BackfillPreconditionError(
      'The upload root (UPLOAD_ROOT) does not exist or is not a directory.'
    );
  }
  await sequelize.authenticate();
  // Also guarantees that the metadata columns exist.
  await assertSchemaUpToDate(sequelize);
};

const readSlicePosition = (
  row: ScannedRow,
  position: number[] | null
): number | null => {
  const normal = row.details?.normal;
  if (
    !position ||
    !Array.isArray(normal) ||
    normal.length !== 3 ||
    !normal.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    return null;
  }
  return positionAlongNormal(position, normal);
};

interface PendingUpdate {
  row: ScannedRow;
  report: BackfillRowReport;
  fill: Partial<PatientImageDicomMetadata>;
}

/**
 * Fills the NULL columns of one row, provided none of its metadata columns
 * changed since it was read; returns whether the row was updated.
 */
const writeRow = async (
  sequelize: Sequelize,
  { row, fill }: PendingUpdate,
  transaction: unknown
) => {
  const bind: unknown[] = [];
  const param = (value: unknown, attribute: MetadataAttribute) => {
    bind.push(value);
    return `$${bind.length}::${columnTypes[attribute]}`;
  };
  const assignments = (Object.keys(fill) as MetadataAttribute[]).map(
    (attribute) =>
      `${quoted(attribute)} = COALESCE(${quoted(attribute)}, ${param(
        fill[attribute],
        attribute
      )})`
  );
  // Optimistic check against the values read in this run: no hybrid row if
  // another process changed the metadata in between.
  const unchanged = patientImageDicomMetadataAttributes.map(
    (attribute) =>
      `${quoted(attribute)} IS NOT DISTINCT FROM ${param(
        row[attribute],
        attribute
      )}`
  );
  bind.push(row.id);
  const [, affected] = await sequelize.query(
    `UPDATE patients_images SET ${assignments.join(', ')}
     WHERE id = $${bind.length}::uuid AND ${unchanged.join(' AND ')}`,
    { bind, type: QueryTypes.UPDATE, transaction: transaction as never }
  );
  return affected === 1;
};

export const runDicomMetadataBackfill = async (
  sequelize: Sequelize,
  options: BackfillOptions
): Promise<BackfillReport> => {
  const startedAt = new Date().toISOString();
  await checkPreconditions(sequelize, options);
  const progress = options.onProgress ?? (() => undefined);

  const rows: BackfillRowReport[] = [];
  /** Values read from files (for the groups), by image id. */
  const scanned = new Map<string, GroupEntry>();
  let lastId = '00000000-0000-0000-0000-000000000000';
  let batchNumber = 0;

  for (;;) {
    const batch = await sequelize.query<ScannedRow>(
      `SELECT i.id, i.source, i.details, i."isBrocken", c."patientId",
              (p."deletedAt" IS NOT NULL) AS trashed, ${metadataSelect}
       FROM patients_images i
       JOIN patient_images_clusters c ON c.id = i."clusterId"
       JOIN patients p ON p.id = c."patientId"
       WHERE i.id > $1::uuid ${options.rescan ? '' : 'AND i."fileSha256" IS NULL'}
       ORDER BY i.id
       LIMIT $2`,
      { bind: [lastId, options.batchSize], type: QueryTypes.SELECT }
    );
    if (!batch.length) break;
    lastId = batch[batch.length - 1].id;
    batchNumber += 1;

    const pending: PendingUpdate[] = [];
    // Sequential file reads, outside any transaction.
    for (const row of batch) {
      const report: BackfillRowReport = {
        imageId: row.id,
        patientId: row.patientId,
        result: 'already_complete',
        filled: [],
        conflicts: [],
        flags: [],
      };
      rows.push(report);

      if (row.trashed && !options.includeTrashed) {
        report.result = 'skipped_trashed_patient';
        continue;
      }
      let file: Awaited<ReturnType<typeof resolveStoredFile>>;
      let parsed: Awaited<ReturnType<typeof parseDicomFile>> | null = null;
      try {
        file = await resolveStoredFile(row.source, options.uploadRoot);
        if (file.ok) parsed = await parseDicomFile(file.realPath);
      } catch {
        report.result = 'read_failed';
        continue;
      }
      if (!file.ok) {
        report.result = file.reason === 'missing' ? 'missing_file' : 'unsafe_path';
        continue;
      }
      if (!parsed?.meta) {
        report.result = 'parse_failed';
        continue;
      }
      const { metadata, fileInfo } = parsed.meta;
      const slicePosition = readSlicePosition(
        row,
        metadata.image.imagePositionPatient
      );
      const values = toPatientImageDicomMetadata(metadata, fileInfo, slicePosition);

      if (!values.studyInstanceUid) report.flags.push('missing_study_uid');
      if (!values.seriesInstanceUid) report.flags.push('missing_series_uid');
      if (!values.sopInstanceUid) report.flags.push('missing_sop_uid');
      for (const field of UID_FIELDS) {
        if (metadata.malformed.includes(field)) {
          report.flags.push(`invalid_uid:${field}`);
        }
      }
      if (slicePosition === null && !row.isBrocken) {
        report.flags.push('no_slice_position');
      }

      const { fill, conflicts } = mergeMetadata(row, values);
      const stored = (attribute: MetadataAttribute) =>
        (normalizeStored(attribute, row[attribute]) ?? null) as string | null;
      scanned.set(row.id, {
        imageId: row.id,
        patientId: row.patientId,
        // What the row holds after this run (a conflicting row is unchanged).
        studyInstanceUid: conflicts.length
          ? stored('studyInstanceUid')
          : stored('studyInstanceUid') ?? values.studyInstanceUid,
        seriesInstanceUid: conflicts.length
          ? stored('seriesInstanceUid')
          : stored('seriesInstanceUid') ?? values.seriesInstanceUid,
        sopInstanceUid: conflicts.length
          ? stored('sopInstanceUid')
          : stored('sopInstanceUid') ?? values.sopInstanceUid,
        fileSha256: conflicts.length
          ? stored('fileSha256')
          : stored('fileSha256') ?? values.fileSha256,
        fileId: file.fileId,
      });

      if (conflicts.length) {
        // No partial update: the row may describe another instance.
        report.result = 'metadata_conflict';
        report.conflicts = conflicts;
        continue;
      }
      report.filled = Object.keys(fill) as MetadataAttribute[];
      if (!report.filled.length) continue;
      report.result = 'would_update';
      pending.push({ row, report, fill });
    }

    if (options.apply && pending.length) {
      await sequelize.transaction(async (transaction) => {
        for (const update of pending) {
          const written = await writeRow(sequelize, update, transaction);
          update.report.result = written ? 'updated' : 'changed_during_run';
          if (!written) update.report.filled = [];
        }
      });
    }
    progress(
      `batch ${batchNumber}: ${batch.length} rows, ` +
        `${pending.length} ${options.apply ? 'updated' : 'to update'}`
    );
  }

  // Groups over all rows: stored values, overlaid with what this run read.
  const all = await sequelize.query<GroupEntry>(
    `SELECT i.id AS "imageId", c."patientId", i."studyInstanceUid",
            i."seriesInstanceUid", i."sopInstanceUid", i."fileSha256",
            NULL AS "fileId"
     FROM patients_images i
     JOIN patient_images_clusters c ON c.id = i."clusterId"`,
    { type: QueryTypes.SELECT }
  );
  const entries = all.map((entry) => scanned.get(entry.imageId) ?? entry);
  const groups = buildGroups(entries, options.hmacKey);

  const count = (result: BackfillRowResult) =>
    rows.filter((row) => row.result === result).length;
  const flagged = (flag: string) =>
    rows.filter((row) => row.flags.some((f) => f.startsWith(flag))).length;
  const summary = {
    totalImages: all.length,
    scanned: rows.length,
    wouldUpdate: count('would_update'),
    updated: count('updated'),
    alreadyComplete: count('already_complete'),
    metadataConflict: count('metadata_conflict'),
    changedDuringRun: count('changed_during_run'),
    missingFile: count('missing_file'),
    unsafePath: count('unsafe_path'),
    readFailed: count('read_failed'),
    parseFailed: count('parse_failed'),
    skippedTrashedPatient: count('skipped_trashed_patient'),
    missingStudyUid: flagged('missing_study_uid'),
    missingSeriesUid: flagged('missing_series_uid'),
    missingSopUid: flagged('missing_sop_uid'),
    invalidUid: flagged('invalid_uid:'),
    noSlicePosition: flagged('no_slice_position'),
    duplicateSopInstanceUidGroups: groups.duplicateSopInstanceUid.length,
    sopUidAcrossPatientsGroups: groups.sopUidAcrossPatients.length,
    studyUidAcrossPatientsGroups: groups.studyUidAcrossPatients.length,
    seriesUidAcrossStudiesGroups: groups.seriesUidAcrossStudies.length,
    duplicateFileHashGroups: groups.duplicateFileHash.length,
    fileHashAcrossPatientsGroups: groups.fileHashAcrossPatients.length,
    sameStoredFileGroups: groups.sameStoredFile.length,
  };

  return {
    run: {
      mode: options.apply ? 'apply' : 'dry-run',
      startedAt,
      finishedAt: new Date().toISOString(),
      options: {
        batchSize: options.batchSize,
        includeTrashed: options.includeTrashed,
        rescan: options.rescan,
      },
    },
    summary,
    rows,
    groups,
  };
};
