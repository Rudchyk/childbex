import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import type { Migration } from './types';

/**
 * Removes the legacy heuristic clusters; the hierarchy is
 * Patient -> Study -> Series -> PatientImage.
 *
 * Preflight (inside the migration transaction, the table locked; nothing is
 * changed when it fails): every image must be linked to a DICOM Series
 * (`seriesId`) and have verified metadata (`fileSha256`, the marker of a
 * complete metadata read). After this migration the tools that could still
 * fix such rows (`backfill dicom-metadata`, `backfill study-series`) no
 * longer run, so the migration refuses instead of orphaning them.
 * `node migrate.js audit cluster-removal` reports the same checks read-only.
 *
 * Then:
 * - patients_images: drop "clusterId" (and its FK) and "details" (cluster
 *   heuristic geometry, including temporary extraction paths);
 *   "seriesId" becomes NOT NULL, ON DELETE CASCADE (Patient -> Study ->
 *   Series -> images -> review records);
 * - completions: "scopeClusterId" -> "legacyScopeClusterId" (values kept,
 *   no FK; never written again);
 * - drop patient_images_clusters.
 *
 * Irreversible (no `down`): the heuristic clusters cannot be reconstructed.
 * Rollback = restore the pre-migration backup (files are not moved).
 */
export const CLUSTER_REMOVAL_MIGRATION = '202610010000-drop-patient-image-clusters';

/** How many image ids a refusal lists (internal UUIDs only). */
const LISTED_IDS = 50;

export interface ClusterRemovalBlockers {
  /** Images without a Series, by broken / not broken. */
  withoutSeries: { total: number; broken: number; ids: string[] };
  /** Images whose metadata was never verified (fileSha256 IS NULL). */
  unverifiedMetadata: { total: number; broken: number; ids: string[] };
}

/** The preflight checks (read-only; also used by `audit cluster-removal`). */
export const findClusterRemovalBlockers = async (
  sequelize: Sequelize,
  transaction?: Transaction
): Promise<ClusterRemovalBlockers> => {
  const check = async (condition: string) => {
    const [counts] = await sequelize.query<{ total: number; broken: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE "isBrocken")::int AS broken
       FROM patients_images WHERE ${condition}`,
      { type: QueryTypes.SELECT, transaction }
    );
    const ids = await sequelize.query<{ id: string }>(
      `SELECT id FROM patients_images WHERE ${condition}
       ORDER BY id LIMIT ${LISTED_IDS}`,
      { type: QueryTypes.SELECT, transaction }
    );
    return { ...counts, ids: ids.map(({ id }) => id) };
  };
  return {
    withoutSeries: await check('"seriesId" IS NULL'),
    unverifiedMetadata: await check('"fileSha256" IS NULL'),
  };
};

export const hasClusterRemovalBlockers = ({
  withoutSeries,
  unverifiedMetadata,
}: ClusterRemovalBlockers) =>
  withoutSeries.total > 0 || unverifiedMetadata.total > 0;

export class ClusterRemovalBlockedError extends Error {
  constructor(readonly blockers: ClusterRemovalBlockers) {
    const { withoutSeries, unverifiedMetadata } = blockers;
    const list = (ids: string[], total: number) =>
      ids.join(', ') + (total > ids.length ? `, ... (${total} in total)` : '');
    super(
      'Cannot remove the legacy clusters; nothing was changed:\n' +
        (withoutSeries.total
          ? `  - ${withoutSeries.total} image(s) not linked to a DICOM Series ` +
            `(${withoutSeries.broken} broken): ${list(withoutSeries.ids, withoutSeries.total)}\n`
          : '') +
        (unverifiedMetadata.total
          ? `  - ${unverifiedMetadata.total} image(s) without verified metadata ` +
            `(${unverifiedMetadata.broken} broken): ${list(unverifiedMetadata.ids, unverifiedMetadata.total)}\n`
          : '') +
        'Run `node migrate.js backfill dicom-metadata` and `node migrate.js ' +
        'backfill study-series` (see db/README.md); images that still cannot ' +
        'be linked need a manual decision. Check with `node migrate.js audit ' +
        'cluster-removal`.'
    );
    this.name = 'ClusterRemovalBlockedError';
  }
}

const dropSql = `
ALTER TABLE patients_images
  DROP CONSTRAINT "patients_images_clusterId_fkey",
  DROP COLUMN "clusterId",
  DROP COLUMN details,
  DROP CONSTRAINT "patients_images_seriesId_fkey",
  ALTER COLUMN "seriesId" SET NOT NULL,
  ADD CONSTRAINT "patients_images_seriesId_fkey"
    FOREIGN KEY ("seriesId") REFERENCES series (id)
    ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE patient_image_review_completions
  RENAME COLUMN "scopeClusterId" TO "legacyScopeClusterId";
ALTER TABLE patient_image_review_completions
  DROP CONSTRAINT patient_image_review_completions_one_scope,
  ADD CONSTRAINT patient_image_review_completions_one_scope
    CHECK (num_nonnulls("legacyScopeClusterId", "scopeSeriesId") = 1);
DROP TABLE patient_images_clusters;
`;

export const dropPatientImageClustersMigration: Migration = {
  name: CLUSTER_REMOVAL_MIGRATION,
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `LOCK TABLE patients_images, patient_images_clusters,
           patient_image_review_completions IN SHARE ROW EXCLUSIVE MODE`,
        { transaction }
      );
      const blockers = await findClusterRemovalBlockers(sequelize, transaction);
      if (hasClusterRemovalBlockers(blockers)) {
        throw new ClusterRemovalBlockedError(blockers);
      }
      await sequelize.query(dropSql, { transaction });
    });
  },
  // No `down`: irreversible (see above).
};
