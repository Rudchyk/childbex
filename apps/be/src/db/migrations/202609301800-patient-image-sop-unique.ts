import { QueryTypes } from 'sequelize';
import type { Migration } from './types';

/**
 * Enforces the DICOM instance identity: no two images with the same non-null
 * SOP Instance UID (NULLs stay allowed). Replaces the non-unique index of
 * 202609301200-patient-image-instance-indexes.
 *
 * The table is locked against writes (SHARE) before the duplicate check, so
 * no duplicate can appear before the index exists. With duplicates the
 * migration fails without any change and without naming a UID; they must be
 * resolved with `cleanup duplicate-sop` first. Nothing is deleted here.
 */
export class DuplicateSopInstancesError extends Error {
  constructor(readonly groups: number) {
    super(
      `Cannot enforce a unique SOP Instance UID: ${groups} duplicate group(s) ` +
        'exist. Run `node migrate.js cleanup duplicate-sop` (dry-run, resolve ' +
        'conflict groups manually, then --apply) until it reports ' +
        'duplicateGroups: 0, then run the migrations again.'
    );
    this.name = 'DuplicateSopInstancesError';
  }
}

export const patientImageSopUniqueMigration: Migration = {
  name: '202609301800-patient-image-sop-unique',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query('LOCK TABLE patients_images IN SHARE MODE', {
        transaction,
      });
      const [{ groups }] = await sequelize.query<{ groups: number }>(
        `SELECT count(*)::int AS groups FROM (
           SELECT 1 FROM patients_images
           WHERE "sopInstanceUid" IS NOT NULL
           GROUP BY "sopInstanceUid"
           HAVING count(*) > 1
         ) duplicates`,
        { type: QueryTypes.SELECT, transaction }
      );
      if (groups > 0) throw new DuplicateSopInstancesError(groups);
      await sequelize.query(
        `DROP INDEX patients_images_sop_instance_uid;
         CREATE UNIQUE INDEX patients_images_sop_instance_uid_unique
           ON patients_images ("sopInstanceUid");`,
        { transaction }
      );
    });
  },
  // Only the uniqueness goes; no data is touched.
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `DROP INDEX patients_images_sop_instance_uid_unique;
         CREATE INDEX patients_images_sop_instance_uid
           ON patients_images ("sopInstanceUid");`,
        { transaction }
      );
    });
  },
};
