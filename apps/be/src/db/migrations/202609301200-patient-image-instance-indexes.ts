import type { Migration } from './types';

/**
 * Non-unique indexes for the DICOM instance deduplication of the import
 * (lookups by SOP Instance UID and by file SHA-256).
 *
 * Deliberately not UNIQUE: existing databases may contain duplicate SOP
 * Instance UIDs from before the deduplication (see `backfill dicom-metadata`
 * reports). They are kept as they are; nothing is deleted or merged. A unique
 * constraint needs a cleanup of those duplicates first.
 */
export const patientImageInstanceIndexesMigration: Migration = {
  name: '202609301200-patient-image-instance-indexes',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `CREATE INDEX patients_images_sop_instance_uid
           ON patients_images ("sopInstanceUid");
         CREATE INDEX patients_images_file_sha256
           ON patients_images ("fileSha256");`,
        { transaction }
      );
    });
  },
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `DROP INDEX patients_images_sop_instance_uid;
         DROP INDEX patients_images_file_sha256;`,
        { transaction }
      );
    });
  },
};
