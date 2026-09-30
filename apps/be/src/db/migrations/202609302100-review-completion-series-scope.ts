import { QueryTypes } from 'sequelize';
import type { Migration } from './types';

/**
 * "Finish review" moves from the (heuristic) cluster to the DICOM Series.
 * Completion provenance gets `scopeSeriesId`; exactly one scope is set.
 * Existing completions keep their `scopeClusterId` unchanged (no series is
 * guessed for them). No data is changed.
 */
export const reviewCompletionSeriesScopeMigration: Migration = {
  name: '202609302100-review-completion-series-scope',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `ALTER TABLE patient_image_review_completions
           ALTER COLUMN "scopeClusterId" DROP NOT NULL,
           ADD COLUMN "scopeSeriesId" uuid,
           ADD CONSTRAINT patient_image_review_completions_one_scope
             CHECK (num_nonnulls("scopeClusterId", "scopeSeriesId") = 1)`,
        { transaction }
      );
    });
  },
  // Refused once series-scoped completions exist: reverting would lose
  // their provenance.
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'LOCK TABLE patient_image_review_completions IN SHARE MODE',
        { transaction }
      );
      const [{ count }] = await sequelize.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM patient_image_review_completions
         WHERE "scopeSeriesId" IS NOT NULL`,
        { type: QueryTypes.SELECT, transaction }
      );
      if (count > 0) {
        throw new Error(
          `Cannot revert: ${count} completion(s) are series-scoped and would ` +
            'lose their provenance.'
        );
      }
      await sequelize.query(
        `ALTER TABLE patient_image_review_completions
           DROP CONSTRAINT patient_image_review_completions_one_scope,
           DROP COLUMN "scopeSeriesId",
           ALTER COLUMN "scopeClusterId" SET NOT NULL`,
        { transaction }
      );
    });
  },
};
