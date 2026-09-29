import type { Migration } from './types';

/**
 * DICOM metadata on patients_images (groundwork for Study/Series, slice
 * ordering, deduplication and CT eligibility). Additive only: nullable
 * columns without defaults (no table rewrite), CHECKs that accept NULL, no
 * indexes or unique constraints yet (added with Study/Series after the
 * backfill). Existing rows keep NULL until they are backfilled.
 */
const columns: [name: string, type: string][] = [
  ['studyInstanceUid', 'varchar(64)'],
  ['seriesInstanceUid', 'varchar(64)'],
  ['sopInstanceUid', 'varchar(64)'],
  ['sopClassUid', 'varchar(64)'],
  ['modality', 'varchar(16)'],
  ['imageType', 'text[]'],
  ['seriesNumber', 'integer'],
  ['instanceNumber', 'integer'],
  ['frameOfReferenceUid', 'varchar(64)'],
  ['seriesDescription', 'text'],
  ['convolutionKernel', 'text'],
  ['imagePositionPatient', 'double precision[]'],
  ['imageOrientationPatient', 'double precision[]'],
  ['slicePosition', 'double precision'],
  ['rows', 'integer'],
  ['columns', 'integer'],
  ['pixelSpacing', 'double precision[]'],
  ['sliceThickness', 'double precision'],
  ['rescaleSlope', 'double precision'],
  ['rescaleIntercept', 'double precision'],
  ['photometricInterpretation', 'varchar(16)'],
  ['bitsStored', 'smallint'],
  ['pixelRepresentation', 'smallint'],
  ['numberOfFrames', 'integer'],
  ['transferSyntaxUid', 'varchar(64)'],
  ['fileSha256', 'char(64)'],
  ['fileSize', 'bigint'],
];

const checks: [name: string, condition: string][] = [
  [
    'patients_images_ipp_length',
    '"imagePositionPatient" IS NULL OR cardinality("imagePositionPatient") = 3',
  ],
  [
    'patients_images_iop_length',
    '"imageOrientationPatient" IS NULL OR cardinality("imageOrientationPatient") = 6',
  ],
  [
    'patients_images_pixel_spacing_length',
    '"pixelSpacing" IS NULL OR cardinality("pixelSpacing") = 2',
  ],
  [
    'patients_images_file_sha256_hex',
    `"fileSha256" IS NULL OR "fileSha256" ~ '^[0-9a-f]{64}$'`,
  ],
];

export const patientImageDicomMetadataMigration: Migration = {
  name: '202609281200-patient-image-dicom-metadata',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      for (const [name, type] of columns) {
        await sequelize.query(
          `ALTER TABLE patients_images ADD COLUMN "${name}" ${type}`,
          { transaction }
        );
      }
      for (const [name, condition] of checks) {
        await sequelize.query(
          `ALTER TABLE patients_images ADD CONSTRAINT ${name} CHECK (${condition})`,
          { transaction }
        );
      }
    });
  },
  // Safe: only the metadata recorded since this migration is dropped, and
  // it can be read again from the stored files.
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      for (const [name] of [...columns].reverse()) {
        await sequelize.query(
          `ALTER TABLE patients_images DROP COLUMN "${name}"`,
          { transaction }
        );
      }
    });
  },
};
