/**
 * Versioned ML dataset snapshots.
 *
 * - A DRAFT holds only its configuration (and seed). `previewSnapshot`
 *   evaluates the current data with it (cheap file checks), writing
 *   nothing.
 * - `finalizeSnapshot` (live review -> short freeze -> immutable snapshot
 *   -> review open again; no manual freeze needed):
 *     1. VERIFY (long; no transaction, no lock, review stays open): the
 *        file of every image that could be included whatever its label
 *        (not trashed / broken, fully reviewable Series, recorded hash) is
 *        re-hashed (SHA-256), one file at a time;
 *     2. CAPTURE (short; one READ COMMITTED transaction): the exclusive
 *        review-freeze lock (pg_advisory_xact_lock, waits at most
 *        CAPTURE_LOCK_TIMEOUT for review mutations in flight, else
 *        REVIEW_FREEZE_CHANGING); while it is held or awaited every label
 *        mutation (votes, Complete review, resolutions, patient trash /
 *        restore / delete) is refused at once with REVIEW_LOCKED, and
 *        nothing else is blocked (viewing, imports). Then the snapshot row
 *        FOR UPDATE, still a DRAFT; membership from the review state at
 *        that moment, using step 1's verification for files that did not
 *        change (any other candidate is re-hashed now); the split (global
 *        quotas, minPatientsPerSplit) on the set left AFTER verification and
 *        every exclusion rule; patients, items and exclusions inserted; the
 *        freeze window recorded (the active manual freeze, else a closed
 *        `review_freezes` row); the snapshot FINALIZED.
 *     3. COMMIT releases the lock (as does a rollback or a lost connection:
 *        nothing can strand it). A failure publishes nothing: the snapshot
 *        stays a DRAFT and can be finalized again.
 *   Long-running dataset preparation (export, preprocessing) reads the
 *   finalized membership afterwards and never holds review locks.
 * - Finalized data is never recomputed from live state (and the database
 *   triggers refuse changes).
 */
import {
  DatasetExclusionReason,
  DatasetLabel,
  DatasetReviewSource,
  DatasetSnapshotStatus,
  DatasetSplit,
  DATASET_SCHEMA_VERSION,
  type CreateDatasetSnapshotRequestBody,
  type DatasetSnapshotConfigV1,
  type DatasetSnapshotItem as DatasetSnapshotItemResponse,
  type DatasetSnapshotItemsResponse,
  type DatasetSnapshotPreview,
  type DatasetSnapshotSummary,
  type DatasetSplitSummary,
  type UpdateDatasetSnapshotRequestBody,
} from '@libs/schemas';
import { Op, QueryTypes, Transaction } from 'sequelize';
import { sequelize } from '../../db/sequelize';
import {
  DatasetSnapshot,
  DatasetSnapshotExclusion,
  DatasetSnapshotItem,
  DatasetSnapshotPatient,
} from '../../db/models/DatasetSnapshot.model';
import { ReviewFreeze } from '../../db/models/ReviewFreeze.model';
import { REVIEW_FREEZE_LOCK_KEY } from '../review.service';
import { toStackImage, type StackImageRow } from '../hierarchy.service';
import { isSimpleStack, orderSeriesImages } from '../series-stack';
import { uploadRoot } from '../storage-roots';
import { DatasetConfigError, resolveConfig, validateConfig } from './config';
import { dataExclusionReason, exclusionReasonOrder, labelOf } from './eligibility';
import { checkImageFile, type FileCheckMode } from './file-check';
import { planSplit, SplitPlanError, type SplitPlan } from './split';

export interface Actor {
  id: string;
  name: string;
}

export type DatasetSnapshotErrorCode =
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_NOT_DRAFT'
  | 'SNAPSHOT_NOT_FINALIZED'
  | 'REVIEW_FREEZE_CHANGING'
  | 'INSUFFICIENT_PATIENTS'
  | 'INVALID_CONFIGURATION'
  | 'PATIENT_IN_DATASET_SNAPSHOT';

const errorStatus: Record<DatasetSnapshotErrorCode, 400 | 404 | 409 | 422> = {
  SNAPSHOT_NOT_FOUND: 404,
  SNAPSHOT_NOT_DRAFT: 409,
  SNAPSHOT_NOT_FINALIZED: 409,
  REVIEW_FREEZE_CHANGING: 409,
  INSUFFICIENT_PATIENTS: 422,
  INVALID_CONFIGURATION: 400,
  PATIENT_IN_DATASET_SNAPSHOT: 409,
};

export class DatasetSnapshotError extends Error {
  readonly status: 400 | 404 | 409 | 422;

  constructor(
    readonly code: DatasetSnapshotErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DatasetSnapshotError';
    this.status = errorStatus[code];
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () =>
  new DatasetSnapshotError('SNAPSHOT_NOT_FOUND', 'The dataset snapshot does not exist.');

const withConfigErrors = <T>(run: () => T): T => {
  try {
    return run();
  } catch (error) {
    if (error instanceof DatasetConfigError) {
      throw new DatasetSnapshotError('INVALID_CONFIGURATION', error.message);
    }
    throw error;
  }
};

// --- Plan (the membership the current data would give) -----------------------

interface SourceRow extends StackImageRow {
  seriesId: string;
  studyId: string;
  patientId: string;
  patientTrashed: boolean;
  reviewState: string;
  reviewStateSource: string;
  fileSha256: string | null;
  fileSize: string | null;
  /** Storage locator: only for the file checks, never stored or returned. */
  source: string;
  normalVotes: number;
  abnormalVotes: number;
  uncertainVotes: number;
  resolutionId: string | null;
  completionId: string | null;
  implicitNormals: number;
}

interface PlannedItem {
  row: SourceRow;
  label: DatasetLabel;
  seriesOrderIndex: number;
}

interface Plan {
  items: PlannedItem[];
  exclusions: { row: SourceRow; reason: DatasetExclusionReason }[];
  split: SplitPlan | null;
  splitError: SplitPlanError | null;
}

/**
 * Every image with what eligibility needs (one query, so one consistent
 * view, ordered). `implicitNormals` counts the reviewers whose latest
 * completed review of the Series covers the image without a vote on it.
 */
const readSourceRows = (transaction?: Transaction) =>
  sequelize.query<SourceRow>(
    `WITH latest_completions AS (
       SELECT DISTINCT ON ("seriesId", "reviewerId") "seriesId", "reviewerId", "imageIds"
       FROM series_review_completions
       ORDER BY "seriesId", "reviewerId", "completedAt" DESC, id DESC)
     SELECT i.id, i."isBrocken", i."instanceNumber", i."imageOrientationPatient",
            i."imagePositionPatient", i."numberOfFrames", i.rows, i.columns, i."pixelSpacing",
            i."seriesId", se."studyId", s."patientId",
            (p."deletedAt" IS NOT NULL) AS "patientTrashed",
            i."reviewState", i."reviewStateSource", i."fileSha256", i."fileSize",
            i.source, i."normalVotes", i."abnormalVotes", i."uncertainVotes",
            r.id AS "resolutionId", c.id AS "completionId",
            (SELECT count(*)::int FROM latest_completions lc
             WHERE lc."seriesId" = i."seriesId" AND i.id = ANY (lc."imageIds")
               AND NOT EXISTS (
                 SELECT 1 FROM patient_image_review_votes v
                 WHERE v."patientImageId" = i.id AND v."reviewerId" = lc."reviewerId")
            ) AS "implicitNormals"
     FROM patients_images i
     JOIN series se ON se.id = i."seriesId"
     JOIN studies s ON s.id = se."studyId"
     JOIN patients p ON p.id = s."patientId"
     LEFT JOIN patient_image_review_resolutions r
       ON r."patientImageId" = i.id AND r."supersededAt" IS NULL
     LEFT JOIN patient_image_review_completions c ON c."patientImageId" = i.id
     ORDER BY i."seriesId", i.id`,
    { type: QueryTypes.SELECT, transaction }
  );

/** Series readiness and display order: the application's shared rule. */
const seriesLayout = (rows: readonly SourceRow[]) => {
  const bySeries = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const seriesRows = bySeries.get(row.seriesId);
    if (seriesRows) seriesRows.push(row);
    else bySeries.set(row.seriesId, [row]);
  }
  const reviewable = new Map<string, boolean>();
  const orderIndex = new Map<string, number>();
  for (const [seriesId, seriesRows] of bySeries) {
    const stack = orderSeriesImages(seriesRows.map(toStackImage));
    reviewable.set(seriesId, isSimpleStack(stack));
    stack.images.forEach(({ image }, index) => orderIndex.set(image.id, index));
  }
  return { reviewable, orderIndex };
};

/** The file check of a candidate image (null: the file passes). */
type FileCheck = (row: SourceRow) => Promise<DatasetExclusionReason | null>;

const buildPlan = async (
  config: DatasetSnapshotConfigV1,
  checkFile: FileCheck,
  transaction?: Transaction,
  onProgress?: (line: string) => void
): Promise<Plan> => {
  const rows = await readSourceRows(transaction);
  const { reviewable, orderIndex } = seriesLayout(rows);

  const items: PlannedItem[] = [];
  const exclusions: Plan['exclusions'] = [];
  const candidates: SourceRow[] = [];
  for (const row of rows) {
    const reason = dataExclusionReason(
      {
        patientTrashed: row.patientTrashed,
        isBroken: row.isBrocken,
        seriesReviewable: reviewable.get(row.seriesId) ?? false,
        reviewState: row.reviewState,
        reviewStateSource: row.reviewStateSource,
        fileSha256: row.fileSha256,
      },
      config
    );
    if (reason) exclusions.push({ row, reason });
    else candidates.push(row);
  }
  // File checks: one file at a time.
  for (const [index, row] of candidates.entries()) {
    const reason = await checkFile(row);
    if (reason) exclusions.push({ row, reason });
    else {
      items.push({
        row,
        label: labelOf(row.reviewState),
        seriesOrderIndex: orderIndex.get(row.id) ?? 0,
      });
    }
    if (onProgress && (index + 1) % 500 === 0) {
      onProgress(`checked ${index + 1}/${candidates.length} file(s)`);
    }
  }

  const perPatient = new Map<string, { normalImages: number; abnormalImages: number }>();
  for (const { row, label } of items) {
    const counts = perPatient.get(row.patientId) ?? { normalImages: 0, abnormalImages: 0 };
    if (label === DatasetLabel.ABNORMAL) counts.abnormalImages += 1;
    else counts.normalImages += 1;
    perPatient.set(row.patientId, counts);
  }
  let split: SplitPlan | null = null;
  let splitError: SplitPlanError | null = null;
  try {
    split = planSplit(
      [...perPatient].map(([patientGroupKey, counts]) => ({ patientGroupKey, ...counts })),
      config.split
    );
  } catch (error) {
    if (!(error instanceof SplitPlanError)) throw error;
    splitError = error;
  }
  return { items, exclusions, split, splitError };
};

const emptyCounts = () => ({
  patients: 0,
  images: 0,
  normal: 0,
  abnormal: 0,
  bySource: {} as Record<string, number>,
});

const increment = (record: Record<string, number>, key: string) => {
  record[key] = (record[key] ?? 0) + 1;
};

/** Per-split counts of a plan. */
const planSplitSummary = (plan: Plan): DatasetSplitSummary | null => {
  if (!plan.split) return null;
  const splitOf = new Map(plan.split.assignments.map((a) => [a.patientGroupKey, a.split]));
  const summary: DatasetSplitSummary = {
    TRAIN: emptyCounts(),
    VALIDATION: emptyCounts(),
    TEST: emptyCounts(),
  };
  for (const { split } of plan.split.assignments) summary[split].patients += 1;
  for (const { row, label } of plan.items) {
    const counts = summary[splitOf.get(row.patientId) as DatasetSplit];
    counts.images += 1;
    if (label === DatasetLabel.ABNORMAL) counts.abnormal += 1;
    else counts.normal += 1;
    increment(counts.bySource, row.reviewStateSource);
  }
  return summary;
};

const exclusionSummary = (plan: Plan) => {
  const byReason: Record<string, number> = {};
  for (const reason of exclusionReasonOrder) {
    const count = plan.exclusions.filter((e) => e.reason === reason).length;
    if (count) byReason[reason] = count;
  }
  return byReason;
};

// --- Reads --------------------------------------------------------------------

const findSnapshot = async (id: string, transaction?: Transaction, lock = false) => {
  if (!UUID.test(id)) throw notFound();
  const snapshot = await DatasetSnapshot.findByPk(id, {
    transaction,
    ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}),
  });
  if (!snapshot) throw notFound();
  return snapshot;
};

const iso = (date: Date | null) => (date ? new Date(date).toISOString() : null);

/** Per-split counts of a finalized snapshot, from its stored membership. */
const storedSplitSummary = async (snapshotId: string): Promise<DatasetSplitSummary> => {
  const rows = await sequelize.query<{
    split: DatasetSplit;
    source: string;
    patients: number;
    images: number;
    normal: number;
    abnormal: number;
  }>(
    `SELECT split, "reviewStateSourceAtSnapshot" AS source,
            count(DISTINCT "patientGroupKey")::int AS patients, count(*)::int AS images,
            count(*) FILTER (WHERE label = 'NORMAL')::int AS normal,
            count(*) FILTER (WHERE label = 'ABNORMAL')::int AS abnormal
     FROM dataset_snapshot_items WHERE "snapshotId" = :snapshotId
     GROUP BY split, "reviewStateSourceAtSnapshot"`,
    { replacements: { snapshotId }, type: QueryTypes.SELECT }
  );
  const patients = await sequelize.query<{ split: DatasetSplit; patients: number }>(
    `SELECT split, count(*)::int AS patients FROM dataset_snapshot_patients
     WHERE "snapshotId" = :snapshotId GROUP BY split`,
    { replacements: { snapshotId }, type: QueryTypes.SELECT }
  );
  const summary: DatasetSplitSummary = {
    TRAIN: emptyCounts(),
    VALIDATION: emptyCounts(),
    TEST: emptyCounts(),
  };
  for (const row of rows) {
    const counts = summary[row.split];
    counts.images += row.images;
    counts.normal += row.normal;
    counts.abnormal += row.abnormal;
    counts.bySource[row.source] = row.images;
  }
  for (const row of patients) summary[row.split].patients = row.patients;
  return summary;
};

const toSummary = async (snapshot: DatasetSnapshot): Promise<DatasetSnapshotSummary> => ({
  id: snapshot.id,
  name: snapshot.name,
  description: snapshot.description,
  status: snapshot.status,
  datasetSchemaVersion: snapshot.datasetSchemaVersion,
  configuration: snapshot.configuration,
  createdByName: snapshot.createdByName,
  createdAt: iso(snapshot.createdAt) as string,
  finalizedAt: iso(snapshot.finalizedAt),
  finalizedByName: snapshot.finalizedByName,
  archivedAt: iso(snapshot.archivedAt),
  archivedByName: snapshot.archivedByName,
  reviewFreezeId: snapshot.reviewFreezeId,
  fileVerification: snapshot.fileVerification,
  totalPatients: snapshot.totalPatients,
  totalImages: snapshot.totalImages,
  normalImages: snapshot.normalImages,
  abnormalImages: snapshot.abnormalImages,
  excludedImages: snapshot.excludedImages,
  exclusionSummary: snapshot.exclusionSummary,
  splits:
    snapshot.status === DatasetSnapshotStatus.DRAFT
      ? null
      : await storedSplitSummary(snapshot.id),
});

export const getSnapshot = async (id: string) => toSummary(await findSnapshot(id));

export const listSnapshots = async () =>
  Promise.all(
    (await DatasetSnapshot.findAll({ order: [['createdAt', 'DESC'], ['id', 'ASC']] })).map(
      toSummary
    )
  );

const MAX_PAGE = 5000;

/** The stored membership (admin manifest; includes the verified SHA-256). */
export const listSnapshotItems = async (
  id: string,
  { split, after, limit }: { split?: DatasetSplit; after?: string; limit?: number }
): Promise<DatasetSnapshotItemsResponse> => {
  const snapshot = await findSnapshot(id);
  const pageSize = Math.min(Math.max(limit ?? 1000, 1), MAX_PAGE);
  if (after !== undefined && !UUID.test(after)) {
    throw new DatasetSnapshotError('INVALID_CONFIGURATION', 'Invalid page cursor.');
  }
  const rows = await DatasetSnapshotItem.findAll({
    where: {
      snapshotId: snapshot.id,
      ...(split ? { split } : {}),
      ...(after ? { patientImageId: { [Op.gt]: after } } : {}),
    },
    order: [['patientImageId', 'ASC']],
    limit: pageSize + 1,
  });
  const page = rows.slice(0, pageSize);
  const items: DatasetSnapshotItemResponse[] = page.map((item) => ({
    patientImageId: item.patientImageId,
    seriesId: item.seriesId,
    studyId: item.studyId,
    patientId: item.patientId,
    patientGroupKey: item.patientGroupKey,
    split: item.split,
    label: item.label,
    reviewStateAtSnapshot: item.reviewStateAtSnapshot,
    reviewStateSourceAtSnapshot: item.reviewStateSourceAtSnapshot,
    reviewResolutionId: item.reviewResolutionId,
    reviewCompletionId: item.reviewCompletionId,
    normalVotes: item.normalVotes,
    abnormalVotes: item.abnormalVotes,
    uncertainVotes: item.uncertainVotes,
    implicitNormals: item.implicitNormals,
    seriesOrderIndex: item.seriesOrderIndex,
    fileSha256: item.fileSha256,
    fileSize: Number(item.fileSize),
  }));
  return {
    items,
    next: rows.length > pageSize ? page[page.length - 1].patientImageId : null,
  };
};

// --- DRAFT lifecycle ---------------------------------------------------------------

export const createSnapshot = async (
  actor: Actor,
  { name, description, configuration }: CreateDatasetSnapshotRequestBody
) => {
  const config = withConfigErrors(() => resolveConfig(configuration));
  const snapshot = await DatasetSnapshot.create({
    name,
    description: description ?? null,
    status: DatasetSnapshotStatus.DRAFT,
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    configuration: config,
    splitSeed: config.split.seed,
    createdById: actor.id,
    createdByName: actor.name,
  });
  return toSummary(snapshot);
};

export const updateDraft = (id: string, body: UpdateDatasetSnapshotRequestBody) =>
  sequelize.transaction(async (transaction) => {
    const snapshot = await findSnapshot(id, transaction, true);
    if (snapshot.status !== DatasetSnapshotStatus.DRAFT) {
      throw new DatasetSnapshotError('SNAPSHOT_NOT_DRAFT', 'Only a DRAFT can be changed.');
    }
    const config = body.configuration
      ? withConfigErrors(() =>
          resolveConfig(body.configuration, validateConfig(snapshot.configuration))
        )
      : snapshot.configuration;
    await snapshot.update(
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        configuration: config,
        splitSeed: config.split.seed,
      },
      { transaction }
    );
    return toSummary(snapshot);
  });

export const deleteDraft = (id: string) =>
  sequelize.transaction(async (transaction) => {
    const snapshot = await findSnapshot(id, transaction, true);
    if (snapshot.status !== DatasetSnapshotStatus.DRAFT) {
      throw new DatasetSnapshotError(
        'SNAPSHOT_NOT_DRAFT',
        'Only a DRAFT can be deleted; a finalized snapshot can only be archived.'
      );
    }
    await snapshot.destroy({ transaction });
  });

export const archiveSnapshot = (id: string, actor: Actor) =>
  sequelize.transaction(async (transaction) => {
    const snapshot = await findSnapshot(id, transaction, true);
    if (snapshot.status !== DatasetSnapshotStatus.FINALIZED) {
      throw new DatasetSnapshotError(
        'SNAPSHOT_NOT_FINALIZED',
        'Only a FINALIZED snapshot can be archived.'
      );
    }
    await snapshot.update(
      {
        status: DatasetSnapshotStatus.ARCHIVED,
        archivedAt: new Date(),
        archivedById: actor.id,
        archivedByName: actor.name,
      },
      { transaction }
    );
    return toSummary(snapshot);
  });

// --- File checks -------------------------------------------------------------------------

const checkSourceFile = (row: SourceRow, mode: FileCheckMode) =>
  checkImageFile(
    { source: row.source, fileSize: row.fileSize, fileSha256: row.fileSha256 as string },
    mode,
    uploadRoot
  );

/** What a file verification was made for: the stored file it read. */
const fileKey = (row: SourceRow) => `${row.source}\n${row.fileSize}\n${row.fileSha256}`;

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Finalization step 1 (no transaction, no lock): re-hashes the file of every
 * image that could be included whatever its review label (labels may still
 * change until the capture). Returns the result per image with the file it
 * was made for.
 */
const verifyCandidateFiles = async (onProgress?: (line: string) => void) => {
  const rows = await readSourceRows();
  const { reviewable } = seriesLayout(rows);
  const candidates = rows.filter(
    (row) =>
      !row.patientTrashed &&
      !row.isBrocken &&
      reviewable.get(row.seriesId) &&
      !!row.fileSha256 &&
      SHA256.test(row.fileSha256)
  );
  const verified = new Map<string, { key: string; reason: DatasetExclusionReason | null }>();
  for (const [index, row] of candidates.entries()) {
    verified.set(row.id, { key: fileKey(row), reason: await checkSourceFile(row, 'sha256') });
    if (onProgress && (index + 1) % 500 === 0) {
      onProgress(`verified ${index + 1}/${candidates.length} file(s) (review open)`);
    }
  }
  return verified;
};

// --- Preview ---------------------------------------------------------------------------

const isReviewFrozen = async (transaction?: Transaction) =>
  !!(await ReviewFreeze.findOne({
    where: { scope: 'global', unfrozenAt: null },
    attributes: ['id'],
    transaction,
  }));

/** What finalizing now would give (no writes; cheap file checks). */
export const previewSnapshot = async (id: string): Promise<DatasetSnapshotPreview> => {
  const snapshot = await findSnapshot(id);
  if (snapshot.status !== DatasetSnapshotStatus.DRAFT) {
    throw new DatasetSnapshotError(
      'SNAPSHOT_NOT_DRAFT',
      'A finalized snapshot is not previewed: its membership is stored.'
    );
  }
  const config = withConfigErrors(() => validateConfig(snapshot.configuration));
  const plan = await buildPlan(config, (row) => checkSourceFile(row, 'size'));
  const labels = { NORMAL: 0, ABNORMAL: 0 };
  const bySource: Record<string, number> = {};
  for (const { label, row } of plan.items) {
    labels[label] += 1;
    increment(bySource, row.reviewStateSource);
  }
  const byReason = exclusionSummary(plan);
  const strata: Record<string, number> = {};
  for (const { stratum } of plan.split?.assignments ?? []) increment(strata, stratum);
  return {
    snapshotId: snapshot.id,
    reviewFrozen: await isReviewFrozen(),
    fileVerification: 'EXISTS_AND_SIZE',
    configuration: config,
    eligiblePatients: new Set(plan.items.map(({ row }) => row.patientId)).size,
    eligibleImages: plan.items.length,
    labels,
    bySource,
    excluded: { total: plan.exclusions.length, byReason },
    strata,
    quotas: plan.split?.quotas ?? null,
    splits: planSplitSummary(plan),
    splitError: plan.splitError
      ? { code: plan.splitError.code, message: plan.splitError.message }
      : null,
  };
};

// --- Finalization ------------------------------------------------------------------------

const INSERT_CHUNK = 1000;

const insertInChunks = async <T>(
  rows: T[],
  insert: (chunk: T[]) => Promise<unknown>
) => {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await insert(rows.slice(i, i + INSERT_CHUNK));
  }
};

/**
 * Longest wait of the capture for review mutations in flight (they are
 * short); after it the finalization fails with REVIEW_FREEZE_CHANGING and
 * can be retried.
 */
export const CAPTURE_LOCK_TIMEOUT = '15s';

/**
 * Builds and stores the snapshot: files verified with review open, labels
 * captured under a short exclusive review lock (see top).
 */
export const finalizeSnapshot = async (
  id: string,
  actor: Actor,
  { onProgress }: { onProgress?: (line: string) => void } = {}
): Promise<DatasetSnapshotSummary> => {
  const pending = await findSnapshot(id);
  if (pending.status !== DatasetSnapshotStatus.DRAFT) {
    throw new DatasetSnapshotError('SNAPSHOT_NOT_DRAFT', 'The snapshot is already finalized.');
  }
  withConfigErrors(() => validateConfig(pending.configuration));

  // 1. Verify (long): review stays open.
  const verified = await verifyCandidateFiles(onProgress);
  onProgress?.('capturing review labels (label mutations briefly locked)');

  // 2. Capture (short): exclusive review lock until the commit.
  try {
    const snapshot = await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${CAPTURE_LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query('SELECT pg_advisory_xact_lock(:key)', {
        replacements: { key: REVIEW_FREEZE_LOCK_KEY },
        transaction,
      });
      await sequelize.query('SET LOCAL lock_timeout = 0', { transaction });
      const frozenAt = new Date();

      const draft = await findSnapshot(id, transaction, true);
      if (draft.status !== DatasetSnapshotStatus.DRAFT) {
        throw new DatasetSnapshotError('SNAPSHOT_NOT_DRAFT', 'The snapshot is already finalized.');
      }
      const config = withConfigErrors(() => validateConfig(draft.configuration));
      const plan = await buildPlan(
        config,
        async (row) => {
          const prior = verified.get(row.id);
          // Verified in step 1 for the same stored file; else (an image
          // that became a candidate meanwhile) re-hashed now.
          return prior && prior.key === fileKey(row)
            ? prior.reason
            : checkSourceFile(row, 'sha256');
        },
        transaction,
        onProgress
      );
      if (!plan.split) {
        throw new DatasetSnapshotError(
          'INSUFFICIENT_PATIENTS',
          plan.splitError?.message ?? 'Not enough eligible patients.'
        );
      }
      const now = new Date();
      const assignments = new Map(
        plan.split.assignments.map((assignment) => [assignment.patientGroupKey, assignment])
      );
      const perPatient = new Map<string, { imageCount: number; normal: number; abnormal: number }>();
      for (const { row, label } of plan.items) {
        const counts = perPatient.get(row.patientId) ?? { imageCount: 0, normal: 0, abnormal: 0 };
        counts.imageCount += 1;
        if (label === DatasetLabel.ABNORMAL) counts.abnormal += 1;
        else counts.normal += 1;
        perPatient.set(row.patientId, counts);
      }
      await insertInChunks([...assignments.values()], (chunk) =>
        DatasetSnapshotPatient.bulkCreate(
          chunk.map((assignment) => {
            const counts = perPatient.get(assignment.patientGroupKey) as {
              imageCount: number;
              normal: number;
              abnormal: number;
            };
            return {
              snapshotId: draft.id,
              patientGroupKey: assignment.patientGroupKey,
              // The grouping key is the internal Patient id (schema v1).
              patientId: assignment.patientGroupKey,
              split: assignment.split,
              stratum: assignment.stratum,
              splitRank: assignment.splitRank,
              imageCount: counts.imageCount,
              normalImages: counts.normal,
              abnormalImages: counts.abnormal,
            };
          }),
          { transaction }
        )
      );
      await insertInChunks(plan.items, (chunk) =>
        DatasetSnapshotItem.bulkCreate(
          chunk.map(({ row, label, seriesOrderIndex }) => ({
            snapshotId: draft.id,
            patientGroupKey: row.patientId,
            split: (assignments.get(row.patientId) as { split: DatasetSplit }).split,
            patientImageId: row.id,
            patientId: row.patientId,
            studyId: row.studyId,
            seriesId: row.seriesId,
            label,
            reviewStateAtSnapshot: row.reviewState,
            reviewStateSourceAtSnapshot: row.reviewStateSource as DatasetReviewSource,
            reviewResolutionId: row.resolutionId,
            reviewCompletionId: row.completionId,
            normalVotes: row.normalVotes,
            abnormalVotes: row.abnormalVotes,
            uncertainVotes: row.uncertainVotes,
            implicitNormals: row.implicitNormals,
            seriesOrderIndex,
            fileSha256: row.fileSha256 as string,
            fileSize: row.fileSize as string,
            createdAt: now,
          })),
          { transaction }
        )
      );
      await insertInChunks(plan.exclusions, (chunk) =>
        DatasetSnapshotExclusion.bulkCreate(
          chunk.map(({ row, reason }) => ({
            snapshotId: draft.id,
            patientImageId: row.id,
            seriesId: row.seriesId,
            patientGroupKey: row.patientId,
            reason,
            createdAt: now,
          })),
          { transaction }
        )
      );
      // The freeze the labels were captured under: an active manual
      // freeze, else this capture's window (recorded closed: the lock ends
      // with this transaction).
      const manualFreeze = await ReviewFreeze.findOne({
        where: { scope: 'global', unfrozenAt: null },
        attributes: ['id'],
        transaction,
      });
      const freezeId =
        manualFreeze?.id ??
        (
          await ReviewFreeze.create(
            {
              reason: `Dataset snapshot capture ${draft.id}`,
              frozenById: actor.id,
              frozenByName: actor.name,
              frozenAt,
              unfrozenAt: new Date(),
              unfrozenById: actor.id,
              unfrozenByName: actor.name,
            },
            { transaction }
          )
        ).id;
      const normal = plan.items.filter(({ label }) => label === DatasetLabel.NORMAL).length;
      await draft.update(
        {
          status: DatasetSnapshotStatus.FINALIZED,
          finalizedAt: now,
          finalizedById: actor.id,
          finalizedByName: actor.name,
          reviewFreezeId: freezeId,
          fileVerification: 'SHA256_REHASHED',
          totalPatients: assignments.size,
          totalImages: plan.items.length,
          normalImages: normal,
          abnormalImages: plan.items.length - normal,
          excludedImages: plan.exclusions.length,
          exclusionSummary: exclusionSummary(plan),
        },
        { transaction }
      );
      return draft;
    });
    return toSummary(snapshot);
  } catch (error) {
    const code = (error as { parent?: { code?: string } }).parent?.code;
    // The lock could not be taken in time (review mutations in flight).
    if (code === '55P03') {
      throw new DatasetSnapshotError(
        'REVIEW_FREEZE_CHANGING',
        'Review changes in progress did not finish in time; try again.'
      );
    }
    throw error;
  }
};

// --- Source deletion -------------------------------------------------------------------------

/** Finalized / archived snapshots whose membership includes images of the patient. */
export const findPatientSnapshotReferences = async (
  patientId: string,
  transaction?: Transaction
) =>
  sequelize.query<{ id: string; name: string; status: string }>(
    `SELECT DISTINCT d.id, d.name, d.status FROM dataset_snapshot_items it
     JOIN dataset_snapshots d ON d.id = it."snapshotId"
     WHERE it."patientId" = :patientId
     ORDER BY d.name, d.id`,
    { replacements: { patientId }, type: QueryTypes.SELECT, transaction }
  );

/**
 * Permanent patient deletion must not remove source images of a finalized
 * dataset snapshot (the items' FK RESTRICT is the database backstop).
 */
export const assertPatientNotInDatasetSnapshots = async (
  patientId: string,
  transaction?: Transaction
) => {
  const snapshots = await findPatientSnapshotReferences(patientId, transaction);
  if (snapshots.length) {
    throw new DatasetSnapshotError(
      'PATIENT_IN_DATASET_SNAPSHOT',
      'The patient has images in finalized dataset snapshots; it cannot be deleted permanently.',
      { snapshots: snapshots.map(({ id, name }) => ({ id, name })) }
    );
  }
};
