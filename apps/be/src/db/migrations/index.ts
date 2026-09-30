import { baselineMigration } from './202609280000-baseline-schema';
import { patientImageDicomMetadataMigration } from './202609281200-patient-image-dicom-metadata';
import { studySeriesMigration } from './202609291200-study-series';
import { patientImageInstanceIndexesMigration } from './202609301200-patient-image-instance-indexes';
import { patientImageSopUniqueMigration } from './202609301800-patient-image-sop-unique';
import { reviewStatusUncertainMigration } from './202609302000-review-status-uncertain';
import { reviewSemanticsSchemaMigration } from './202609302010-review-semantics-schema';
import { reviewStateRequiredMigration } from './202609302020-review-state-required';
import { reviewCompletionSeriesScopeMigration } from './202609302100-review-completion-series-scope';
import { dropPatientImageClustersMigration } from './202610010000-drop-patient-image-clusters';
import { datasetSnapshotsMigration } from './202610020000-dataset-snapshots';
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
  studySeriesMigration,
  patientImageInstanceIndexesMigration,
  patientImageSopUniqueMigration,
  reviewStatusUncertainMigration,
  reviewSemanticsSchemaMigration,
  reviewStateRequiredMigration,
  reviewCompletionSeriesScopeMigration,
  dropPatientImageClustersMigration,
  datasetSnapshotsMigration,
];
