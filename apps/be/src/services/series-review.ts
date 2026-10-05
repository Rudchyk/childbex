/**
 * Reads of reviewers' "Complete review" of DICOM Series (shared by
 * review.service.ts, which writes them, and hierarchy.service.ts).
 *
 * The LATEST completion of a reviewer for a Series counts: every image in
 * its image set the reviewer did not vote on is the reviewer's implicit
 * NORMAL opinion.
 */
import { createHash } from 'node:crypto';
import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '../db/sequelize';

/**
 * Image-set revision of a Series review: SHA-256 of the sorted image ids
 * (one per line). Equal revisions mean exactly the same images.
 */
export const imageSetRevision = (imageIds: readonly string[]) =>
  createHash('sha256')
    .update([...imageIds].sort().join('\n'))
    .digest('hex');

export interface ImplicitNormal {
  reviewerId: string;
  reviewerName: string;
  completedAt: Date;
}

/**
 * Implicit NORMAL opinions of images: per image, the reviewers whose latest
 * completion of the image's Series covers the image and who have no
 * explicit vote on it (an explicit vote always takes precedence).
 */
export const findImplicitNormals = async (
  imageIds: readonly string[],
  transaction?: Transaction
): Promise<Map<string, ImplicitNormal[]>> => {
  const byImage = new Map<string, ImplicitNormal[]>();
  if (!imageIds.length) return byImage;
  // Maintenance commands (review-state backfill) can run on a schema from
  // before migration 202610050000: no completions exist there.
  const [{ present }] = await sequelize.query<{ present: boolean }>(
    `SELECT to_regclass('series_review_completions') IS NOT NULL AS present`,
    { type: QueryTypes.SELECT, transaction }
  );
  if (!present) return byImage;
  const rows = await sequelize.query<ImplicitNormal & { patientImageId: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (c."seriesId", c."reviewerId")
              c."seriesId", c."reviewerId", c."reviewerName", c."completedAt", c."imageIds"
       FROM series_review_completions c
       WHERE c."seriesId" IN (
         SELECT DISTINCT "seriesId" FROM patients_images WHERE id IN (:ids))
       ORDER BY c."seriesId", c."reviewerId", c."completedAt" DESC, c.id DESC)
     SELECT i.id AS "patientImageId", l."reviewerId", l."reviewerName", l."completedAt"
     FROM patients_images i
     JOIN latest l ON l."seriesId" = i."seriesId" AND i.id = ANY (l."imageIds")
     WHERE i.id IN (:ids)
       AND NOT EXISTS (
         SELECT 1 FROM patient_image_review_votes v
         WHERE v."patientImageId" = i.id AND v."reviewerId" = l."reviewerId")
     ORDER BY i.id, l."completedAt", l."reviewerId"`,
    { replacements: { ids: [...imageIds] }, type: QueryTypes.SELECT, transaction }
  );
  for (const { patientImageId, ...implicit } of rows) {
    byImage.set(patientImageId, [...(byImage.get(patientImageId) ?? []), implicit]);
  }
  return byImage;
};

export interface LatestSeriesCompletion {
  reviewerId: string;
  reviewerName: string;
  completedAt: Date;
  imageSetHash: string;
  imageCount: number;
  imageIds: string[];
}

/** The latest completion of every reviewer who completed the Series. */
export const findLatestSeriesCompletions = (
  seriesId: string,
  transaction?: Transaction
) =>
  sequelize.query<LatestSeriesCompletion>(
    `SELECT DISTINCT ON ("reviewerId") "reviewerId", "reviewerName", "completedAt",
            "imageSetHash", "imageCount", "imageIds"
     FROM series_review_completions WHERE "seriesId" = :seriesId
     ORDER BY "reviewerId", "completedAt" DESC, id DESC`,
    { replacements: { seriesId }, type: QueryTypes.SELECT, transaction }
  );
