import type { Migration } from './types';

/**
 * Adds `uncertain` to the legacy status enum (a compatibility cache of the
 * review state; UNCERTAIN could not be represented before).
 *
 * Its own migration and outside a transaction: a value added by ALTER TYPE
 * cannot be used in the same transaction (and older PostgreSQL versions do
 * not allow it in a transaction at all). No data is changed.
 */
export const reviewStatusUncertainMigration: Migration = {
  name: '202609302000-review-status-uncertain',
  async up({ sequelize }) {
    await sequelize.query(
      `ALTER TYPE enum_patients_images_status ADD VALUE IF NOT EXISTS 'uncertain'`
    );
  },
  // PostgreSQL cannot remove an enum value; an unused value is harmless.
  async down() {
    return;
  },
};
