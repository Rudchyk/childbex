import { QueryTypes } from 'sequelize';
import type { Migration } from './types';

/**
 * Per-reviewer "Complete review" of a DICOM Series (radiologist workflow,
 * issue #13).
 *
 * - `series_review_completions`: append-only. One row per Complete review
 *   action: the reviewer, when, and exactly which (non-broken) images of the
 *   Series the reviewer was shown (`imageIds`) with the image-set revision
 *   (`imageSetHash`, SHA-256 of the sorted ids). The latest row of a reviewer
 *   for a Series gives that reviewer an IMPLICIT NORMAL opinion on every image
 *   in its set the reviewer did not vote on. No vote rows are created, the
 *   review is never locked, and an image added to the Series later is not
 *   covered until the reviewer completes the review again.
 * - `dataset_snapshot_items."implicitNormals"`: provenance of a snapshot
 *   label (the implicit NORMAL opinions it was derived from). 0 for items
 *   finalized before this migration, which is exact: none existed then.
 *   (ADD COLUMN with a constant default fires no row trigger, so finalized
 *   rows stay untouched.)
 */
const upSql = `
CREATE TABLE series_review_completions (
  id uuid NOT NULL,
  "seriesId" uuid NOT NULL,
  "reviewerId" varchar(255) NOT NULL,
  "reviewerName" varchar(255) NOT NULL,
  "imageIds" uuid[] NOT NULL,
  "imageCount" integer NOT NULL,
  "imageSetHash" char(64) NOT NULL,
  "completedAt" timestamptz NOT NULL,
  CONSTRAINT series_review_completions_pkey PRIMARY KEY (id),
  CONSTRAINT "series_review_completions_seriesId_fkey" FOREIGN KEY ("seriesId")
    REFERENCES series (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT series_review_completions_image_count
    CHECK ("imageCount" = cardinality("imageIds")),
  CONSTRAINT series_review_completions_image_set_hash
    CHECK ("imageSetHash" ~ '^[0-9a-f]{64}$')
);
-- The latest completion of a reviewer for a Series.
CREATE INDEX series_review_completions_series_reviewer
  ON series_review_completions ("seriesId", "reviewerId", "completedAt" DESC);

ALTER TABLE dataset_snapshot_items
  ADD COLUMN "implicitNormals" integer NOT NULL DEFAULT 0;
`;

const downSql = `
ALTER TABLE dataset_snapshot_items DROP COLUMN "implicitNormals";
DROP TABLE series_review_completions;
`;

export const seriesReviewCompletionsMigration: Migration = {
  name: '202610050000-series-review-completions',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(upSql, { transaction });
    });
  },
  // Refused once a review was completed or a snapshot recorded implicit
  // NORMAL provenance: reverting would lose reviewers' opinions.
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        'LOCK TABLE series_review_completions, dataset_snapshot_items IN SHARE MODE',
        { transaction }
      );
      const [{ completions, items }] = await sequelize.query<{
        completions: number;
        items: number;
      }>(
        `SELECT (SELECT count(*)::int FROM series_review_completions) AS completions,
                (SELECT count(*)::int FROM dataset_snapshot_items
                 WHERE "implicitNormals" > 0) AS items`,
        { type: QueryTypes.SELECT, transaction }
      );
      if (completions > 0 || items > 0) {
        throw new Error(
          `Cannot revert: ${completions} series review completion(s) and ` +
            `${items} dataset snapshot item(s) with implicit NORMAL provenance would be lost.`
        );
      }
      await sequelize.query(downSql, { transaction });
    });
  },
};
