import type { Migration } from './types';

/**
 * DICOM Study and Series entities: Patient -> Study -> Series -> PatientImage
 * (in parallel with PatientImagesCluster during the transition).
 *
 * - The UIDs are globally unique: the tables are new and empty, and existing
 *   images are only linked by `backfill study-series`, which leaves
 *   conflicting UIDs unlinked. Rows are created with
 *   `INSERT ... ON CONFLICT DO NOTHING` (safe for concurrent imports).
 * - studies/series follow the patient (ON DELETE CASCADE); an image keeps
 *   its series from being deleted (NO ACTION: checked at the end of the
 *   statement, so a patient's cascade that also removes the images works).
 *   Deleting a cluster does not delete studies or series.
 */
const upSql = `
CREATE TABLE studies (
  id uuid NOT NULL,
  "patientId" uuid NOT NULL,
  "studyInstanceUid" varchar(64) NOT NULL,
  "studyDate" date,
  "studyTime" varchar(16),
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT studies_pkey PRIMARY KEY (id),
  CONSTRAINT "studies_patientId_fkey" FOREIGN KEY ("patientId")
    REFERENCES patients (id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX studies_study_instance_uid ON studies ("studyInstanceUid");
CREATE INDEX studies_patient_id ON studies ("patientId");

CREATE TABLE series (
  id uuid NOT NULL,
  "studyId" uuid NOT NULL,
  "seriesInstanceUid" varchar(64) NOT NULL,
  "seriesNumber" integer,
  "seriesDescription" text,
  modality varchar(16),
  "imageType" text[],
  "frameOfReferenceUid" varchar(64),
  "convolutionKernel" text,
  "sliceThickness" double precision,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT series_pkey PRIMARY KEY (id),
  CONSTRAINT "series_studyId_fkey" FOREIGN KEY ("studyId")
    REFERENCES studies (id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX series_series_instance_uid ON series ("seriesInstanceUid");
CREATE INDEX series_study_id ON series ("studyId");

ALTER TABLE patients_images ADD COLUMN "seriesId" uuid;
ALTER TABLE patients_images ADD CONSTRAINT "patients_images_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES series (id)
  ON UPDATE CASCADE ON DELETE NO ACTION;
CREATE INDEX patients_images_series_id ON patients_images ("seriesId");
`;

const downSql = `
ALTER TABLE patients_images DROP COLUMN "seriesId";
DROP TABLE series;
DROP TABLE studies;
`;

export const studySeriesMigration: Migration = {
  name: '202609291200-study-series',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(upSql, { transaction });
    });
  },
  // Drops the links and the entities: the links can be rebuilt from the
  // image metadata with `backfill study-series` (study date/time are read
  // from the files again).
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(downSql, { transaction });
    });
  },
};
