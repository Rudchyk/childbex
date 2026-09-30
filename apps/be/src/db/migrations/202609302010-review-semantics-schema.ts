import type { Migration } from './types';

/**
 * Review semantics schema (no clinical data is reinterpreted here):
 *
 * - patient_image_review_vote_events: append-only history of vote changes;
 * - patient_image_review_resolutions: explicit admin resolutions (append-only,
 *   an older one is superseded, never rewritten); `origin` also records
 *   legacy resolutions confirmed or set aside by an operator;
 * - patient_image_review_completions: provenance of "Finish review"
 *   (an image completed as NORMAL; not a vote, not a resolution);
 * - review_freezes: the review freeze (one active per scope; now 'global');
 * - patients_images.reviewState / reviewStateSource: the cached effective
 *   state. Existing rows stay NULL ("not derived yet") until
 *   `backfill review-state --apply`; only new rows get the defaults.
 *   Migration 202609302020 makes them NOT NULL.
 */
const upSql = `
CREATE TABLE patient_image_review_vote_events (
  id uuid NOT NULL,
  "patientImageId" uuid NOT NULL,
  "reviewerId" varchar(255) NOT NULL,
  "reviewerName" varchar(255) NOT NULL,
  action varchar(16) NOT NULL,
  "previousVote" varchar(16),
  "newVote" varchar(16) NOT NULL,
  "previousComment" text,
  "newComment" text,
  "createdAt" timestamptz NOT NULL,
  CONSTRAINT patient_image_review_vote_events_pkey PRIMARY KEY (id),
  CONSTRAINT "patient_image_review_vote_events_patientImageId_fkey"
    FOREIGN KEY ("patientImageId") REFERENCES patients_images (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT patient_image_review_vote_events_action
    CHECK (action IN ('cast', 'changed')),
  CONSTRAINT patient_image_review_vote_events_votes
    CHECK ("newVote" IN ('normal', 'abnormal', 'uncertain')
      AND ("previousVote" IS NULL OR "previousVote" IN ('normal', 'abnormal', 'uncertain')))
);
CREATE INDEX patient_image_review_vote_events_patient_image_id
  ON patient_image_review_vote_events ("patientImageId");

CREATE TABLE patient_image_review_resolutions (
  id uuid NOT NULL,
  "patientImageId" uuid NOT NULL,
  label varchar(16),
  origin varchar(32) NOT NULL DEFAULT 'admin',
  "resolverId" varchar(255),
  "resolverName" varchar(255),
  comment text,
  -- Legacy only: when the legacy resolution was made (if recorded); createdAt
  -- is when the operator confirmed or set it aside.
  "legacyResolvedAt" timestamptz,
  "confirmedByName" varchar(255),
  "createdAt" timestamptz NOT NULL,
  "supersededAt" timestamptz,
  "supersededById" varchar(255),
  "supersededByName" varchar(255),
  CONSTRAINT patient_image_review_resolutions_pkey PRIMARY KEY (id),
  CONSTRAINT "patient_image_review_resolutions_patientImageId_fkey"
    FOREIGN KEY ("patientImageId") REFERENCES patients_images (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT patient_image_review_resolutions_label
    CHECK (label IS NULL OR label IN ('NORMAL', 'ABNORMAL', 'UNCERTAIN')),
  CONSTRAINT patient_image_review_resolutions_origin
    CHECK (origin IN ('admin', 'legacy_confirmed', 'legacy_unlabeled')),
  -- Only a set-aside legacy resolution has no label, and it is never active.
  CONSTRAINT patient_image_review_resolutions_labelled
    CHECK (label IS NOT NULL OR origin = 'legacy_unlabeled'),
  CONSTRAINT patient_image_review_resolutions_unlabeled_inactive
    CHECK (origin <> 'legacy_unlabeled' OR "supersededAt" IS NOT NULL),
  -- A new admin resolution always knows its resolver; legacy ones may not.
  CONSTRAINT patient_image_review_resolutions_admin_resolver
    CHECK (origin <> 'admin' OR ("resolverId" IS NOT NULL AND "resolverName" IS NOT NULL)),
  CONSTRAINT patient_image_review_resolutions_confirmed
    CHECK (origin = 'admin' OR "confirmedByName" IS NOT NULL),
  CONSTRAINT patient_image_review_resolutions_legacy_time
    CHECK (origin <> 'admin' OR "legacyResolvedAt" IS NULL)
);
CREATE UNIQUE INDEX patient_image_review_resolutions_one_active
  ON patient_image_review_resolutions ("patientImageId")
  WHERE ("supersededAt" IS NULL);
CREATE INDEX patient_image_review_resolutions_patient_image_id
  ON patient_image_review_resolutions ("patientImageId");

CREATE TABLE patient_image_review_completions (
  id uuid NOT NULL,
  "patientImageId" uuid NOT NULL,
  "runId" uuid NOT NULL,
  "scopeClusterId" uuid NOT NULL,
  "completedById" varchar(255) NOT NULL,
  "completedByName" varchar(255) NOT NULL,
  "createdAt" timestamptz NOT NULL,
  CONSTRAINT patient_image_review_completions_pkey PRIMARY KEY (id),
  CONSTRAINT "patient_image_review_completions_patientImageId_fkey"
    FOREIGN KEY ("patientImageId") REFERENCES patients_images (id)
    ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX patient_image_review_completions_patient_image_id
  ON patient_image_review_completions ("patientImageId");

CREATE TABLE review_freezes (
  id uuid NOT NULL,
  scope varchar(16) NOT NULL DEFAULT 'global',
  reason text NOT NULL,
  "frozenById" varchar(255) NOT NULL,
  "frozenByName" varchar(255) NOT NULL,
  "frozenAt" timestamptz NOT NULL,
  "unfrozenAt" timestamptz,
  "unfrozenById" varchar(255),
  "unfrozenByName" varchar(255),
  CONSTRAINT review_freezes_pkey PRIMARY KEY (id),
  CONSTRAINT review_freezes_scope CHECK (scope IN ('global'))
);
CREATE UNIQUE INDEX review_freezes_one_active
  ON review_freezes (scope) WHERE ("unfrozenAt" IS NULL);

ALTER TABLE patients_images
  ADD COLUMN "reviewState" varchar(16),
  ADD COLUMN "reviewStateSource" varchar(16),
  ADD CONSTRAINT patients_images_review_state CHECK ("reviewState" IS NULL OR
    "reviewState" IN ('NOT_REVIEWED', 'NORMAL', 'ABNORMAL', 'UNCERTAIN', 'CONFLICTED')),
  ADD CONSTRAINT patients_images_review_state_source CHECK ("reviewStateSource" IS NULL OR
    "reviewStateSource" IN ('NONE', 'VOTES', 'RESOLUTION', 'FINISH_REVIEW'));
-- Defaults for new rows only: existing rows stay NULL (not derived yet).
ALTER TABLE patients_images
  ALTER COLUMN "reviewState" SET DEFAULT 'NOT_REVIEWED',
  ALTER COLUMN "reviewStateSource" SET DEFAULT 'NONE';
`;

const downSql = `
ALTER TABLE patients_images
  DROP COLUMN "reviewState",
  DROP COLUMN "reviewStateSource";
DROP TABLE review_freezes;
DROP TABLE patient_image_review_completions;
DROP TABLE patient_image_review_resolutions;
DROP TABLE patient_image_review_vote_events;
`;

export const reviewSemanticsSchemaMigration: Migration = {
  name: '202609302010-review-semantics-schema',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(upSql, { transaction });
    });
  },
  // Drops the review history recorded since this migration.
  async down({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(downSql, { transaction });
    });
  },
};
