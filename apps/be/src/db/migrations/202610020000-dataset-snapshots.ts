import { QueryTypes } from 'sequelize';
import type { Migration } from './types';

/**
 * Versioned, immutable ML dataset snapshots.
 *
 * - dataset_snapshots: a DRAFT holds only its configuration; FINALIZED
 *   (then optionally ARCHIVED) snapshots hold the membership written once by
 *   the finalization transaction (services/dataset-snapshot).
 * - dataset_snapshot_patients: the split unit (one split per patient,
 *   enforced by the composite FK of the items).
 * - dataset_snapshot_items: the included images with their frozen label,
 *   review provenance and verified file hash; patientImageId ON DELETE
 *   RESTRICT: source images of a finalized snapshot cannot be deleted.
 * - dataset_snapshot_exclusions: every other image with its (first
 *   matching) exclusion reason.
 *
 * Triggers make finalized data immutable: rows of the child tables can only
 * be written while their snapshot is a DRAFT; a snapshot can only go
 * DRAFT -> FINALIZED -> ARCHIVED (nothing else of a finalized snapshot
 * changes) and only a DRAFT can be deleted.
 */
const upSql = `
CREATE TABLE dataset_snapshots (
  id uuid NOT NULL,
  name varchar(200) NOT NULL,
  description text,
  status varchar(16) NOT NULL DEFAULT 'DRAFT',
  "datasetSchemaVersion" integer NOT NULL,
  configuration jsonb NOT NULL,
  "splitSeed" text NOT NULL,
  "createdById" varchar(255) NOT NULL,
  "createdByName" varchar(255) NOT NULL,
  "finalizedAt" timestamptz,
  "finalizedById" varchar(255),
  "finalizedByName" varchar(255),
  "archivedAt" timestamptz,
  "archivedById" varchar(255),
  "archivedByName" varchar(255),
  "reviewFreezeId" uuid,
  "fileVerification" varchar(32),
  "totalPatients" integer,
  "totalImages" integer,
  "normalImages" integer,
  "abnormalImages" integer,
  "excludedImages" integer,
  "exclusionSummary" jsonb,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT dataset_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT "dataset_snapshots_reviewFreezeId_fkey" FOREIGN KEY ("reviewFreezeId")
    REFERENCES review_freezes (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT dataset_snapshots_status CHECK (status IN ('DRAFT', 'FINALIZED', 'ARCHIVED')),
  CONSTRAINT dataset_snapshots_schema_version CHECK ("datasetSchemaVersion" >= 1),
  CONSTRAINT dataset_snapshots_finalized CHECK (
    (status = 'DRAFT' AND "finalizedAt" IS NULL AND "finalizedById" IS NULL
      AND "finalizedByName" IS NULL AND "reviewFreezeId" IS NULL
      AND "fileVerification" IS NULL AND "totalPatients" IS NULL
      AND "totalImages" IS NULL AND "normalImages" IS NULL
      AND "abnormalImages" IS NULL AND "excludedImages" IS NULL
      AND "exclusionSummary" IS NULL)
    OR (status <> 'DRAFT' AND "finalizedAt" IS NOT NULL AND "finalizedById" IS NOT NULL
      AND "finalizedByName" IS NOT NULL AND "reviewFreezeId" IS NOT NULL
      AND "fileVerification" IS NOT NULL AND "totalPatients" IS NOT NULL
      AND "totalImages" IS NOT NULL AND "normalImages" IS NOT NULL
      AND "abnormalImages" IS NOT NULL AND "excludedImages" IS NOT NULL
      AND "exclusionSummary" IS NOT NULL)),
  CONSTRAINT dataset_snapshots_archived CHECK (
    (status = 'ARCHIVED') = ("archivedAt" IS NOT NULL)
    AND ("archivedAt" IS NULL) = ("archivedById" IS NULL)
    AND ("archivedAt" IS NULL) = ("archivedByName" IS NULL)),
  -- Schema version 1: a finalized snapshot's bytes were always re-hashed.
  CONSTRAINT dataset_snapshots_file_verification CHECK (
    "fileVerification" IS NULL OR "fileVerification" = 'SHA256_REHASHED'),
  CONSTRAINT dataset_snapshots_counts CHECK (
    "totalImages" IS NULL OR "totalImages" = "normalImages" + "abnormalImages")
);

CREATE TABLE dataset_snapshot_patients (
  "snapshotId" uuid NOT NULL,
  "patientGroupKey" varchar(128) NOT NULL,
  "patientId" uuid NOT NULL,
  split varchar(16) NOT NULL,
  stratum varchar(16) NOT NULL,
  "splitRank" char(64) NOT NULL,
  "imageCount" integer NOT NULL,
  "normalImages" integer NOT NULL,
  "abnormalImages" integer NOT NULL,
  CONSTRAINT dataset_snapshot_patients_pkey PRIMARY KEY ("snapshotId", "patientGroupKey"),
  CONSTRAINT "dataset_snapshot_patients_snapshotId_fkey" FOREIGN KEY ("snapshotId")
    REFERENCES dataset_snapshots (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT dataset_snapshot_patients_split CHECK (split IN ('TRAIN', 'VALIDATION', 'TEST')),
  CONSTRAINT dataset_snapshot_patients_stratum CHECK (
    stratum IN ('NORMAL_ONLY', 'ABNORMAL_ONLY', 'MIXED')),
  CONSTRAINT dataset_snapshot_patients_rank CHECK ("splitRank" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dataset_snapshot_patients_counts CHECK (
    "imageCount" > 0 AND "imageCount" = "normalImages" + "abnormalImages")
);
CREATE UNIQUE INDEX dataset_snapshot_patients_split_key
  ON dataset_snapshot_patients ("snapshotId", "patientGroupKey", split);

CREATE TABLE dataset_snapshot_items (
  id uuid NOT NULL,
  "snapshotId" uuid NOT NULL,
  "patientGroupKey" varchar(128) NOT NULL,
  split varchar(16) NOT NULL,
  "patientImageId" uuid NOT NULL,
  "patientId" uuid NOT NULL,
  "studyId" uuid NOT NULL,
  "seriesId" uuid NOT NULL,
  label varchar(16) NOT NULL,
  "reviewStateAtSnapshot" varchar(16) NOT NULL,
  "reviewStateSourceAtSnapshot" varchar(16) NOT NULL,
  "reviewResolutionId" uuid,
  "reviewCompletionId" uuid,
  "normalVotes" integer NOT NULL,
  "abnormalVotes" integer NOT NULL,
  "uncertainVotes" integer NOT NULL,
  "seriesOrderIndex" integer NOT NULL,
  "fileSha256" char(64) NOT NULL,
  "fileSize" bigint NOT NULL,
  "createdAt" timestamptz NOT NULL,
  CONSTRAINT dataset_snapshot_items_pkey PRIMARY KEY (id),
  CONSTRAINT "dataset_snapshot_items_snapshotId_fkey" FOREIGN KEY ("snapshotId")
    REFERENCES dataset_snapshots (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- An image carries exactly its patient's split.
  CONSTRAINT dataset_snapshot_items_patient_split_fkey
    FOREIGN KEY ("snapshotId", "patientGroupKey", split)
    REFERENCES dataset_snapshot_patients ("snapshotId", "patientGroupKey", split)
    ON DELETE CASCADE,
  -- Source images of a finalized snapshot cannot be deleted.
  CONSTRAINT "dataset_snapshot_items_patientImageId_fkey" FOREIGN KEY ("patientImageId")
    REFERENCES patients_images (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT dataset_snapshot_items_split CHECK (split IN ('TRAIN', 'VALIDATION', 'TEST')),
  CONSTRAINT dataset_snapshot_items_label CHECK (label IN ('NORMAL', 'ABNORMAL')),
  -- Schema version 1: the label is the authoritative review state.
  CONSTRAINT dataset_snapshot_items_label_state CHECK (label = "reviewStateAtSnapshot"),
  CONSTRAINT dataset_snapshot_items_source CHECK (
    "reviewStateSourceAtSnapshot" IN ('VOTES', 'RESOLUTION', 'FINISH_REVIEW')),
  CONSTRAINT dataset_snapshot_items_sha256 CHECK ("fileSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dataset_snapshot_items_size CHECK ("fileSize" >= 0)
);
CREATE UNIQUE INDEX dataset_snapshot_items_snapshot_image
  ON dataset_snapshot_items ("snapshotId", "patientImageId");
-- The RESTRICT check when an image is deleted.
CREATE INDEX dataset_snapshot_items_patient_image_id
  ON dataset_snapshot_items ("patientImageId");

CREATE TABLE dataset_snapshot_exclusions (
  id uuid NOT NULL,
  "snapshotId" uuid NOT NULL,
  "patientImageId" uuid NOT NULL,
  "seriesId" uuid NOT NULL,
  "patientGroupKey" varchar(128) NOT NULL,
  reason varchar(32) NOT NULL,
  "createdAt" timestamptz NOT NULL,
  CONSTRAINT dataset_snapshot_exclusions_pkey PRIMARY KEY (id),
  CONSTRAINT "dataset_snapshot_exclusions_snapshotId_fkey" FOREIGN KEY ("snapshotId")
    REFERENCES dataset_snapshots (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT dataset_snapshot_exclusions_reason CHECK (reason IN (
    'PATIENT_TRASHED', 'BROKEN', 'SERIES_NOT_FULLY_REVIEWABLE', 'NOT_REVIEWED',
    'UNCERTAIN', 'CONFLICTED', 'REVIEW_SOURCE_NOT_INCLUDED', 'MISSING_FILE_HASH',
    'MISSING_FILE', 'FILE_SIZE_MISMATCH', 'FILE_HASH_MISMATCH'))
);
CREATE UNIQUE INDEX dataset_snapshot_exclusions_snapshot_image
  ON dataset_snapshot_exclusions ("snapshotId", "patientImageId");

-- Child rows: written only while the snapshot is a DRAFT (i.e. inside the
-- finalization transaction). A cascade from a deleted DRAFT is allowed.
CREATE FUNCTION dataset_snapshot_child_guard() RETURNS trigger AS $$
DECLARE parent_status varchar;
BEGIN
  SELECT status INTO parent_status FROM dataset_snapshots
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."snapshotId" ELSE NEW."snapshotId" END;
  IF FOUND AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'dataset snapshot is immutable (%): % on % refused', parent_status, TG_OP, TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."snapshotId" <> OLD."snapshotId" THEN
    RAISE EXCEPTION 'dataset snapshot rows cannot move' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dataset_snapshot_patients_immutable BEFORE INSERT OR UPDATE OR DELETE
  ON dataset_snapshot_patients FOR EACH ROW EXECUTE FUNCTION dataset_snapshot_child_guard();
CREATE TRIGGER dataset_snapshot_items_immutable BEFORE INSERT OR UPDATE OR DELETE
  ON dataset_snapshot_items FOR EACH ROW EXECUTE FUNCTION dataset_snapshot_child_guard();
CREATE TRIGGER dataset_snapshot_exclusions_immutable BEFORE INSERT OR UPDATE OR DELETE
  ON dataset_snapshot_exclusions FOR EACH ROW EXECUTE FUNCTION dataset_snapshot_child_guard();

-- Snapshots: DRAFT -> FINALIZED -> ARCHIVED; a finalized snapshot changes
-- nothing but its archiving; only a DRAFT is deleted.
CREATE FUNCTION dataset_snapshot_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'dataset snapshot is immutable (%): delete refused', OLD.status
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'FINALIZED') THEN
      RAISE EXCEPTION 'a DRAFT can only be finalized' USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'FINALIZED' AND NEW.status = 'ARCHIVED' THEN
    IF (to_jsonb(NEW) - 'status' - 'archivedAt' - 'archivedById' - 'archivedByName' - 'updatedAt')
       <> (to_jsonb(OLD) - 'status' - 'archivedAt' - 'archivedById' - 'archivedByName' - 'updatedAt') THEN
      RAISE EXCEPTION 'archiving changes nothing else' USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'dataset snapshot is immutable (%): update refused', OLD.status
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER dataset_snapshots_immutable BEFORE UPDATE OR DELETE
  ON dataset_snapshots FOR EACH ROW EXECUTE FUNCTION dataset_snapshot_guard();
`;

const downSql = `
DROP TABLE dataset_snapshot_exclusions;
DROP TABLE dataset_snapshot_items;
DROP TABLE dataset_snapshot_patients;
DROP TABLE dataset_snapshots;
DROP FUNCTION dataset_snapshot_child_guard();
DROP FUNCTION dataset_snapshot_guard();
`;

export const datasetSnapshotsMigration: Migration = {
  name: '202610020000-dataset-snapshots',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(upSql, { transaction });
    });
  },
  // Refused once a snapshot was finalized: that would drop dataset
  // provenance (drafts only hold a configuration).
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query('LOCK TABLE dataset_snapshots IN SHARE MODE', {
        transaction,
      });
      const [{ count }] = await sequelize.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM dataset_snapshots WHERE status <> 'DRAFT'`,
        { type: QueryTypes.SELECT, transaction }
      );
      if (count > 0) {
        throw new Error(
          `Cannot revert: ${count} finalized dataset snapshot(s) would be lost.`
        );
      }
      await sequelize.query(downSql, { transaction });
    });
  },
};
