/**
 * Review state of images imported before the review semantics (maintenance
 * commands, never run on startup):
 *
 * - `audit review-state` (read-only): images without a derived state,
 *   ambiguous legacy resolutions, and derived images whose cached fields do
 *   not match their authoritative review data (verification).
 * - `backfill review-state` (dry-run unless `apply`): derives the state of
 *   images whose `reviewState` is still NULL from their votes, and stores it
 *   with all compatibility caches (`updatedAt` unchanged).
 *
 * Legacy admin resolutions never recorded a label, so they are ambiguous: an
 * image with any legacy resolution field is left untouched (and reported)
 * until an operator decides, per image:
 *   - NORMAL | ABNORMAL | UNCERTAIN: recorded as an active resolution with
 *     origin `legacy_confirmed` (historical resolver, comment and time kept
 *     as they were; `confirmedByName` = the operator);
 *   - IGNORE: recorded as inactive history (origin `legacy_unlabeled`); the
 *     state then comes from the votes.
 * Never creates completions, never invents a label or a resolver identity.
 * Idempotent: derived images are not processed again.
 *
 * Reports contain internal ids, codes and counters only (no names, comments
 * or DICOM data).
 */
import { QueryTypes, type Sequelize } from 'sequelize';
import {
  PatientImageReviewVoteTypes,
  ReviewResolutionLabel,
} from '@libs/schemas';
import { assertMigratedThrough } from '../migrator';
import { BackfillPreconditionError } from './dicom-metadata.backfill';
import { PatientImageReviewResolution } from '../models/PatientImageReviewResolution.model';
import {
  acquireReviewMutationLock,
  planReviewCaches,
  recomputeReviewCaches,
  type ImageReviewPlan,
} from '../../services/review.service';
import {
  deriveReviewCaches,
  type ReviewCaches,
} from '../../services/review-state';

/** The migration that adds the review tables and columns. */
export const REVIEW_SCHEMA_MIGRATION = '202609302010-review-semantics-schema';
export const REVIEW_STATE_REQUIRED_MIGRATION =
  '202609302020-review-state-required';

export type LegacyResolutionDecision = ReviewResolutionLabel | 'IGNORE';

export const legacyResolutionDecisions: readonly LegacyResolutionDecision[] = [
  ...Object.values(ReviewResolutionLabel),
  'IGNORE',
];

interface ImageRow {
  id: string;
  clusterId: string;
  status: string;
  adminResolutionId: string | null;
  adminResolutionName: string | null;
  resolutionComment: string | null;
  resolvedAt: Date | null;
  reviewState: string | null;
}

const imageColumns = `id, "clusterId", status::text AS status,
  "adminResolutionId", "adminResolutionName", "resolutionComment",
  "resolvedAt", "reviewState"`;

/** Names of the legacy resolution fields an image has (no values). */
export const legacyResolutionFields = (row: ImageRow) =>
  [
    row.status === 'admin_resolved' ? 'status' : null,
    row.adminResolutionId !== null ? 'adminResolutionId' : null,
    row.adminResolutionName !== null ? 'adminResolutionName' : null,
    row.resolutionComment !== null ? 'resolutionComment' : null,
    row.resolvedAt !== null ? 'resolvedAt' : null,
  ].filter((field): field is string => field !== null);

export interface AmbiguousLegacyResolution {
  imageId: string;
  clusterId: string;
  legacyFields: string[];
  votes: { normal: number; abnormal: number; uncertain: number };
}

const ambiguousEntry = (
  row: ImageRow,
  plan: ImageReviewPlan
): AmbiguousLegacyResolution => ({
  imageId: row.id,
  clusterId: row.clusterId,
  legacyFields: legacyResolutionFields(row),
  votes: {
    normal: plan.expected.normalVotes,
    abnormal: plan.expected.abnormalVotes,
    uncertain: plan.expected.uncertainVotes,
  },
});

const readBatch = (
  sequelize: Sequelize,
  where: string,
  after: string,
  limit: number
) =>
  sequelize.query<ImageRow>(
    `SELECT ${imageColumns} FROM patients_images
     WHERE ${where} AND id > :after ORDER BY id LIMIT :limit`,
    { replacements: { after, limit }, type: QueryTypes.SELECT }
  );

const FIRST_ID = '00000000-0000-0000-0000-000000000000';

const increment = (counters: Record<string, number>, key: string) => {
  counters[key] = (counters[key] ?? 0) + 1;
};

// --- Audit -------------------------------------------------------------------

export interface ReviewStateAuditReport {
  run: { startedAt: string; finishedAt: string };
  summary: {
    images: number;
    derived: number;
    notDerived: number;
    ambiguousLegacyResolutions: number;
    cacheMismatches: number;
    activeResolutions: number;
    legacyResolutionsConfirmed: number;
    legacyResolutionsIgnored: number;
    completions: number;
    /** Votes cast before the vote history existed (informational). */
    votesWithoutHistory: number;
    reviewFrozen: number;
    reviewStateRequired: number;
  };
  /** Derived images: `<reviewState>/<reviewStateSource>` -> count. */
  states: Record<string, number>;
  ambiguous: AmbiguousLegacyResolution[];
  /** Derived images whose cached fields differ from a recomputation. */
  mismatches: { imageId: string; fields: string[] }[];
}

export const runReviewStateAudit = async (
  sequelize: Sequelize,
  { batchSize = 500 }: { batchSize?: number } = {}
): Promise<ReviewStateAuditReport> => {
  await assertMigratedThrough(sequelize, REVIEW_SCHEMA_MIGRATION);
  const startedAt = new Date().toISOString();
  const report: ReviewStateAuditReport = {
    run: { startedAt, finishedAt: startedAt },
    summary: {
      images: 0,
      derived: 0,
      notDerived: 0,
      ambiguousLegacyResolutions: 0,
      cacheMismatches: 0,
      activeResolutions: 0,
      legacyResolutionsConfirmed: 0,
      legacyResolutionsIgnored: 0,
      completions: 0,
      votesWithoutHistory: 0,
      reviewFrozen: 0,
      reviewStateRequired: 0,
    },
    states: {},
    ambiguous: [],
    mismatches: [],
  };

  for (let after = FIRST_ID; ; ) {
    const rows = await readBatch(sequelize, 'true', after, batchSize);
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    const plans = new Map(
      (await planReviewCaches(rows.map(({ id }) => id))).map((plan) => [
        plan.imageId,
        plan,
      ])
    );
    for (const row of rows) {
      const plan = plans.get(row.id);
      if (!plan) continue;
      report.summary.images++;
      if (row.reviewState === null) {
        report.summary.notDerived++;
        if (legacyResolutionFields(row).length) {
          report.ambiguous.push(ambiguousEntry(row, plan));
        }
        continue;
      }
      report.summary.derived++;
      increment(
        report.states,
        `${plan.stored.reviewState}/${plan.stored.reviewStateSource}`
      );
      const fields = Object.keys(plan.changes);
      if (fields.length) report.mismatches.push({ imageId: row.id, fields });
    }
  }
  report.summary.ambiguousLegacyResolutions = report.ambiguous.length;
  report.summary.cacheMismatches = report.mismatches.length;

  const count = async (sql: string) =>
    (
      await sequelize.query<{ count: number }>(sql, {
        type: QueryTypes.SELECT,
        plain: true,
      })
    )?.count ?? 0;
  report.summary.activeResolutions = await count(
    `SELECT count(*)::int AS count FROM patient_image_review_resolutions
     WHERE "supersededAt" IS NULL`
  );
  report.summary.legacyResolutionsConfirmed = await count(
    `SELECT count(*)::int AS count FROM patient_image_review_resolutions
     WHERE origin = 'legacy_confirmed'`
  );
  report.summary.legacyResolutionsIgnored = await count(
    `SELECT count(*)::int AS count FROM patient_image_review_resolutions
     WHERE origin = 'legacy_unlabeled'`
  );
  report.summary.completions = await count(
    'SELECT count(*)::int AS count FROM patient_image_review_completions'
  );
  report.summary.votesWithoutHistory = await count(
    `SELECT count(*)::int AS count FROM patient_image_review_votes v
     WHERE NOT EXISTS (
       SELECT 1 FROM patient_image_review_vote_events e
       WHERE e."patientImageId" = v."patientImageId"
         AND e."reviewerId" = v."reviewerId")`
  );
  report.summary.reviewFrozen = await count(
    `SELECT count(*)::int AS count FROM review_freezes
     WHERE "unfrozenAt" IS NULL`
  );
  report.summary.reviewStateRequired = await count(
    `SELECT count(*)::int AS count FROM migrations_meta
     WHERE name = '${REVIEW_STATE_REQUIRED_MIGRATION}'`
  );
  report.run.finishedAt = new Date().toISOString();
  return report;
};

// --- Backfill ----------------------------------------------------------------

export interface ReviewStateBackfillOptions {
  apply: boolean;
  /** Operator decisions for ambiguous legacy resolutions, by image id. */
  decisions?: ReadonlyMap<string, LegacyResolutionDecision>;
  /** Mandatory with decisions: recorded as `confirmedByName`. */
  operator?: string | null;
  batchSize?: number;
  onProgress?: (line: string) => void;
}

export type LegacyDecisionOutcome =
  | 'would_apply'
  | 'applied'
  /** Applied by an earlier run (idempotent rerun). */
  | 'already_applied';

export interface ReviewStateBackfillReport {
  run: {
    mode: 'dry-run' | 'apply';
    startedAt: string;
    finishedAt: string;
    operator: string | null;
  };
  summary: {
    images: number;
    alreadyDerived: number;
    notDerived: number;
    /** dry-run: would be derived; apply: derived. */
    derived: number;
    ambiguousLegacyResolutions: number;
    legacyResolutionsConfirmed: number;
    legacyResolutionsIgnored: number;
    statusCacheChanges: number;
    counterCorrections: number;
    changedDuringRun: number;
    remainingNotDerived: number;
  };
  /** Derived images: `<reviewState>/<reviewStateSource>` -> count. */
  states: Record<string, number>;
  /** Legacy status -> new status cache, e.g. `normal->not_reviewed`. */
  statusTransitions: Record<string, number>;
  /** Left untouched: an operator decision is needed. */
  ambiguous: AmbiguousLegacyResolution[];
  decisions: {
    imageId: string;
    decision: LegacyResolutionDecision;
    operator: string;
    outcome: LegacyDecisionOutcome;
  }[];
}

const MAX_OPERATOR_LENGTH = 255;

/**
 * Checks every decision before anything is written: it must name an existing
 * image with a legacy resolution that is not derived yet (or was already
 * handled by an earlier run with a legacy resolution record).
 */
const checkDecisions = async (
  sequelize: Sequelize,
  decisions: ReadonlyMap<string, LegacyResolutionDecision>,
  operator: string | null
) => {
  if (!decisions.size) {
    if (operator !== null) {
      throw new BackfillPreconditionError(
        '--operator is only used with --legacy-resolution.'
      );
    }
    return new Set<string>();
  }
  if (!operator?.trim() || operator.length > MAX_OPERATOR_LENGTH) {
    throw new BackfillPreconditionError(
      `--operator "<name>" (at most ${MAX_OPERATOR_LENGTH} characters) is ` +
        'required with --legacy-resolution.'
    );
  }
  const ids = [...decisions.keys()];
  const rows = await sequelize.query<ImageRow>(
    `SELECT ${imageColumns} FROM patients_images WHERE id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT }
  );
  const legacyRecorded = new Set(
    (
      await sequelize.query<{ id: string }>(
        `SELECT DISTINCT "patientImageId" AS id
         FROM patient_image_review_resolutions
         WHERE "patientImageId" IN (:ids) AND origin <> 'admin'`,
        { replacements: { ids }, type: QueryTypes.SELECT }
      )
    ).map(({ id }) => id)
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems: string[] = [];
  const alreadyApplied = new Set<string>();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) problems.push(`${id}: no such image`);
    else if (row.reviewState !== null) {
      if (legacyRecorded.has(id)) alreadyApplied.add(id);
      else problems.push(`${id}: review state already derived`);
    } else if (!legacyResolutionFields(row).length) {
      problems.push(`${id}: no legacy resolution`);
    }
  }
  if (problems.length) {
    throw new BackfillPreconditionError(
      'Invalid --legacy-resolution (nothing was written):\n' +
        problems.map((problem) => `  - ${problem}`).join('\n')
    );
  }
  return alreadyApplied;
};

/** Votes as a list (the derivation only needs the labels). */
const votesOf = ({ normalVotes, abnormalVotes, uncertainVotes }: ReviewCaches) => [
  ...Array<PatientImageReviewVoteTypes>(normalVotes).fill(
    PatientImageReviewVoteTypes.NORMAL
  ),
  ...Array<PatientImageReviewVoteTypes>(abnormalVotes).fill(
    PatientImageReviewVoteTypes.ABNORMAL
  ),
  ...Array<PatientImageReviewVoteTypes>(uncertainVotes).fill(
    PatientImageReviewVoteTypes.UNCERTAIN
  ),
];

export const runReviewStateBackfill = async (
  sequelize: Sequelize,
  {
    apply,
    decisions = new Map(),
    operator = null,
    batchSize = 200,
    onProgress,
  }: ReviewStateBackfillOptions
): Promise<ReviewStateBackfillReport> => {
  await assertMigratedThrough(sequelize, REVIEW_SCHEMA_MIGRATION);
  const alreadyApplied = await checkDecisions(sequelize, decisions, operator);
  const startedAt = new Date().toISOString();
  const report: ReviewStateBackfillReport = {
    run: {
      mode: apply ? 'apply' : 'dry-run',
      startedAt,
      finishedAt: startedAt,
      operator: decisions.size ? operator : null,
    },
    summary: {
      images: 0,
      alreadyDerived: 0,
      notDerived: 0,
      derived: 0,
      ambiguousLegacyResolutions: 0,
      legacyResolutionsConfirmed: 0,
      legacyResolutionsIgnored: 0,
      statusCacheChanges: 0,
      counterCorrections: 0,
      changedDuringRun: 0,
      remainingNotDerived: 0,
    },
    states: {},
    statusTransitions: {},
    ambiguous: [],
    decisions: [...alreadyApplied].map((imageId) => ({
      imageId,
      decision: decisions.get(imageId) as LegacyResolutionDecision,
      operator: operator as string,
      outcome: 'already_applied',
    })),
  };
  const [{ images }] = await sequelize.query<{ images: number }>(
    'SELECT count(*)::int AS images FROM patients_images',
    { type: QueryTypes.SELECT }
  );
  report.summary.images = images;

  /** Records the planned/applied result of a derived image. */
  const recordDerived = (
    legacyStatus: string,
    plan: ImageReviewPlan,
    expected: ReviewCaches
  ) => {
    report.summary.derived++;
    increment(
      report.states,
      `${expected.reviewState}/${expected.reviewStateSource}`
    );
    if (legacyStatus !== expected.status) {
      report.summary.statusCacheChanges++;
      increment(report.statusTransitions, `${legacyStatus}->${expected.status}`);
    }
    const { stored } = plan;
    if (
      stored.votesCount !== expected.votesCount ||
      stored.normalVotes !== expected.normalVotes ||
      stored.abnormalVotes !== expected.abnormalVotes ||
      stored.uncertainVotes !== expected.uncertainVotes
    ) {
      report.summary.counterCorrections++;
    }
  };

  for (let after = FIRST_ID; ; ) {
    const rows = await readBatch(
      sequelize,
      '"reviewState" IS NULL',
      after,
      batchSize
    );
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    report.summary.notDerived += rows.length;

    const plans = new Map(
      (await planReviewCaches(rows.map(({ id }) => id))).map((plan) => [
        plan.imageId,
        plan,
      ])
    );
    const ready: ImageRow[] = [];
    for (const row of rows) {
      const plan = plans.get(row.id);
      if (!plan) continue;
      if (legacyResolutionFields(row).length && !decisions.has(row.id)) {
        report.ambiguous.push(ambiguousEntry(row, plan));
      } else {
        ready.push(row);
      }
    }

    if (!apply) {
      for (const row of ready) {
        const plan = plans.get(row.id) as ImageReviewPlan;
        const decision = decisions.get(row.id);
        const expected = decision
          ? deriveReviewCaches(
              {
                votes: votesOf(plan.expected),
                resolution:
                  decision === 'IGNORE'
                    ? null
                    : {
                        label: decision,
                        resolverId: row.adminResolutionId,
                        resolverName: row.adminResolutionName,
                        comment: row.resolutionComment,
                        legacyResolvedAt: row.resolvedAt,
                        createdAt: new Date(),
                      },
                completed: false,
              },
              plan.isBroken
            )
          : plan.expected;
        recordDerived(row.status, plan, expected);
        if (decision) {
          if (decision === 'IGNORE') report.summary.legacyResolutionsIgnored++;
          else report.summary.legacyResolutionsConfirmed++;
          report.decisions.push({
            imageId: row.id,
            decision,
            operator: operator as string,
            outcome: 'would_apply',
          });
        }
      }
      continue;
    }
    if (!ready.length) continue;

    // One transaction per batch: the rows are locked and re-checked.
    await sequelize.transaction(async (transaction) => {
      await acquireReviewMutationLock(transaction);
      const locked = await sequelize.query<ImageRow>(
        `SELECT ${imageColumns} FROM patients_images
         WHERE id IN (:ids) ORDER BY id FOR UPDATE`,
        {
          replacements: { ids: ready.map(({ id }) => id) },
          type: QueryTypes.SELECT,
          transaction,
        }
      );
      const current = new Map(locked.map((row) => [row.id, row]));
      const toDerive: ImageRow[] = [];
      for (const planned of ready) {
        const row = current.get(planned.id);
        if (
          !row ||
          row.reviewState !== null ||
          (legacyResolutionFields(row).length > 0 && !decisions.has(row.id))
        ) {
          report.summary.changedDuringRun++;
          continue;
        }
        toDerive.push(row);
        const decision = decisions.get(row.id);
        if (!decision) continue;
        const now = new Date();
        await PatientImageReviewResolution.create(
          {
            patientImageId: row.id,
            label: decision === 'IGNORE' ? null : decision,
            origin: decision === 'IGNORE' ? 'legacy_unlabeled' : 'legacy_confirmed',
            // As recorded (null when unknown): never a fabricated identity.
            resolverId: row.adminResolutionId,
            resolverName: row.adminResolutionName,
            comment: row.resolutionComment,
            legacyResolvedAt: row.resolvedAt,
            confirmedByName: operator,
            createdAt: now,
            ...(decision === 'IGNORE'
              ? { supersededAt: now, supersededByName: operator }
              : {}),
          },
          { transaction }
        );
        if (decision === 'IGNORE') report.summary.legacyResolutionsIgnored++;
        else report.summary.legacyResolutionsConfirmed++;
        report.decisions.push({
          imageId: row.id,
          decision,
          operator: operator as string,
          outcome: 'applied',
        });
      }
      const results = await recomputeReviewCaches(
        toDerive.map(({ id }) => id),
        transaction,
        { silent: true }
      );
      const statusById = new Map(toDerive.map((row) => [row.id, row.status]));
      for (const plan of results) {
        recordDerived(statusById.get(plan.imageId) as string, plan, plan.expected);
      }
    });
    onProgress?.(
      `processed ${report.summary.notDerived} image(s) without a review state`
    );
  }

  report.summary.alreadyDerived = images - report.summary.notDerived;
  report.summary.ambiguousLegacyResolutions = report.ambiguous.length;
  report.summary.remainingNotDerived = apply
    ? (
        await sequelize.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM patients_images
           WHERE "reviewState" IS NULL`,
          { type: QueryTypes.SELECT, plain: true }
        )
      )?.count ?? 0
    : report.summary.notDerived - report.summary.derived;
  report.run.finishedAt = new Date().toISOString();
  return report;
};
