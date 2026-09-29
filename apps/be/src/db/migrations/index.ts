import { baselineMigration } from './202609280000-baseline-schema';
import { patientImageDicomMetadataMigration } from './202609281200-patient-image-dicom-metadata';
import type { Migration } from './types';

export type { Migration, MigrationContext } from './types';

/**
 * All migrations in the order they are applied. Registered explicitly (not
 * discovered from the file system) because the backend is bundled into a
 * single file. Add new migrations at the end.
 */
export const migrations: Migration[] = [
  baselineMigration,
  patientImageDicomMetadataMigration,
];
