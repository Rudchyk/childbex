import { QueryTypes } from 'sequelize';
import type { Migration } from './types';

/**
 * Makes the cached review state required. Refuses (without changes) while any
 * image has no derived state yet: `backfill review-state --apply` must run
 * first, and ambiguous legacy resolutions need an explicit operator decision.
 */
export class ReviewStateNotDerivedError extends Error {
  constructor(readonly images: number) {
    super(
      `Cannot require the review state: ${images} image(s) have no derived ` +
        'review state yet. Run `node migrate.js audit review-state`, resolve ' +
        'ambiguous legacy resolutions with `node migrate.js backfill ' +
        'review-state --legacy-resolution <imageId>=<NORMAL|ABNORMAL|UNCERTAIN|IGNORE> ' +
        '--operator "<name>"`, run `node migrate.js backfill review-state ' +
        '--apply`, then run the migrations again.'
    );
    this.name = 'ReviewStateNotDerivedError';
  }
}

export const reviewStateRequiredMigration: Migration = {
  name: '202609302020-review-state-required',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query('LOCK TABLE patients_images IN SHARE MODE', {
        transaction,
      });
      const [{ images }] = await sequelize.query<{ images: number }>(
        `SELECT count(*)::int AS images FROM patients_images
         WHERE "reviewState" IS NULL OR "reviewStateSource" IS NULL`,
        { type: QueryTypes.SELECT, transaction }
      );
      if (images > 0) throw new ReviewStateNotDerivedError(images);
      await sequelize.query(
        `ALTER TABLE patients_images
           ALTER COLUMN "reviewState" SET NOT NULL,
           ALTER COLUMN "reviewStateSource" SET NOT NULL`,
        { transaction }
      );
    });
  },
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `ALTER TABLE patients_images
           ALTER COLUMN "reviewState" DROP NOT NULL,
           ALTER COLUMN "reviewStateSource" DROP NOT NULL`,
        { transaction }
      );
    });
  },
};
