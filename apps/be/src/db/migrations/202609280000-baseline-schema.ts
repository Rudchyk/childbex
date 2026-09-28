import type { Migration } from './types';

/**
 * The schema as Sequelize model sync created it before migrations were
 * introduced (4 tables, 2 enums). New databases get it from `up`; existing
 * databases are only marked as migrated by the baseline command, after their
 * live schema was checked against `baselineSchema` below.
 */
const createSchemaSql = `
CREATE TYPE enum_patient_image_review_votes_vote AS ENUM (
  'normal', 'abnormal', 'uncertain'
);
CREATE TYPE enum_patients_images_status AS ENUM (
  'not_reviewed', 'normal', 'abnormal', 'conflicted', 'admin_resolved', 'broken'
);

CREATE TABLE patients (
  id uuid NOT NULL,
  name varchar(255) NOT NULL,
  slug varchar(255) NOT NULL,
  "creatorId" varchar(255) NOT NULL,
  "creatorName" varchar(255) NOT NULL,
  notes text DEFAULT '' NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "deletedAt" timestamptz,
  CONSTRAINT patients_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX uniq_patient_slug_active
  ON patients (slug) WHERE ("deletedAt" IS NULL);

CREATE TABLE patient_images_clusters (
  id uuid NOT NULL,
  name varchar(255) NOT NULL,
  cluster integer NOT NULL,
  "patientId" uuid NOT NULL,
  notes text,
  "studyDate" timestamptz,
  "inReview" boolean DEFAULT false NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT patient_images_clusters_pkey PRIMARY KEY (id),
  CONSTRAINT "patient_images_clusters_patientId_fkey" FOREIGN KEY ("patientId")
    REFERENCES patients (id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX patient_images_clusters_cluster_patient_id_study_date
  ON patient_images_clusters (cluster, "patientId", "studyDate");

CREATE TABLE patients_images (
  id uuid NOT NULL,
  source varchar(255) NOT NULL,
  notes text,
  "clusterId" uuid NOT NULL,
  "isBrocken" boolean DEFAULT false NOT NULL,
  "isAbnormal" boolean DEFAULT false NOT NULL,
  details json,
  status enum_patients_images_status DEFAULT 'not_reviewed' NOT NULL,
  "adminResolutionId" varchar(255),
  "adminResolutionName" varchar(255),
  "resolutionComment" varchar(255),
  "resolvedAt" timestamptz,
  "votesCount" integer DEFAULT 0 NOT NULL,
  "normalVotes" integer DEFAULT 0 NOT NULL,
  "abnormalVotes" integer DEFAULT 0 NOT NULL,
  "uncertainVotes" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT patients_images_pkey PRIMARY KEY (id),
  CONSTRAINT patients_images_source_key UNIQUE (source),
  CONSTRAINT "patients_images_clusterId_fkey" FOREIGN KEY ("clusterId")
    REFERENCES patient_images_clusters (id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE patient_image_review_votes (
  id uuid NOT NULL,
  "patientImageId" uuid NOT NULL,
  "reviewerId" varchar(255) NOT NULL,
  "reviewerName" varchar(255) NOT NULL,
  vote enum_patient_image_review_votes_vote NOT NULL,
  comment text,
  "createdAt" timestamptz NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  CONSTRAINT patient_image_review_votes_pkey PRIMARY KEY (id),
  CONSTRAINT "patient_image_review_votes_patientImageId_fkey"
    FOREIGN KEY ("patientImageId")
    REFERENCES patients_images (id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX patient_image_review_votes_patient_image_id_reviewer_id
  ON patient_image_review_votes ("patientImageId", "reviewerId");
`;

export interface ExpectedColumn {
  /** Postgres `udt_name` (e.g. `varchar`, `timestamptz`, an enum name). */
  type: string;
  nullable: boolean;
}

export interface ExpectedUniqueIndex {
  table: string;
  columns: string[];
  /** Partial index predicate as printed by Postgres, if any. */
  where?: string;
  primary?: boolean;
}

export interface ExpectedForeignKey {
  table: string;
  columns: string[];
  references: string;
  onDelete: 'CASCADE';
}

export interface ExpectedSchema {
  tables: Record<string, Record<string, ExpectedColumn>>;
  enums: Record<string, string[]>;
  uniqueIndexes: ExpectedUniqueIndex[];
  foreignKeys: ExpectedForeignKey[];
}

const col = (type: string, nullable = false): ExpectedColumn => ({
  type,
  nullable,
});
const timestamps = {
  createdAt: col('timestamptz'),
  updatedAt: col('timestamptz'),
};

/** What the application relies on; checked before an existing DB is baselined. */
export const baselineSchema: ExpectedSchema = {
  tables: {
    patients: {
      id: col('uuid'),
      name: col('varchar'),
      slug: col('varchar'),
      creatorId: col('varchar'),
      creatorName: col('varchar'),
      notes: col('text'),
      ...timestamps,
      deletedAt: col('timestamptz', true),
    },
    patient_images_clusters: {
      id: col('uuid'),
      name: col('varchar'),
      cluster: col('int4'),
      patientId: col('uuid'),
      notes: col('text', true),
      studyDate: col('timestamptz', true),
      inReview: col('bool'),
      ...timestamps,
    },
    patients_images: {
      id: col('uuid'),
      source: col('varchar'),
      notes: col('text', true),
      clusterId: col('uuid'),
      isBrocken: col('bool'),
      isAbnormal: col('bool'),
      details: col('json', true),
      status: col('enum_patients_images_status'),
      adminResolutionId: col('varchar', true),
      adminResolutionName: col('varchar', true),
      resolutionComment: col('varchar', true),
      resolvedAt: col('timestamptz', true),
      votesCount: col('int4'),
      normalVotes: col('int4'),
      abnormalVotes: col('int4'),
      uncertainVotes: col('int4'),
      ...timestamps,
    },
    patient_image_review_votes: {
      id: col('uuid'),
      patientImageId: col('uuid'),
      reviewerId: col('varchar'),
      reviewerName: col('varchar'),
      vote: col('enum_patient_image_review_votes_vote'),
      comment: col('text', true),
      ...timestamps,
    },
  },
  enums: {
    enum_patient_image_review_votes_vote: ['normal', 'abnormal', 'uncertain'],
    enum_patients_images_status: [
      'not_reviewed',
      'normal',
      'abnormal',
      'conflicted',
      'admin_resolved',
      'broken',
    ],
  },
  uniqueIndexes: [
    { table: 'patients', columns: ['id'], primary: true },
    {
      table: 'patients',
      columns: ['slug'],
      where: '("deletedAt" IS NULL)',
    },
    { table: 'patient_images_clusters', columns: ['id'], primary: true },
    {
      table: 'patient_images_clusters',
      columns: ['cluster', 'patientId', 'studyDate'],
    },
    { table: 'patients_images', columns: ['id'], primary: true },
    { table: 'patients_images', columns: ['source'] },
    { table: 'patient_image_review_votes', columns: ['id'], primary: true },
    {
      table: 'patient_image_review_votes',
      columns: ['patientImageId', 'reviewerId'],
    },
  ],
  foreignKeys: [
    {
      table: 'patient_images_clusters',
      columns: ['patientId'],
      references: 'patients',
      onDelete: 'CASCADE',
    },
    {
      table: 'patients_images',
      columns: ['clusterId'],
      references: 'patient_images_clusters',
      onDelete: 'CASCADE',
    },
    {
      table: 'patient_image_review_votes',
      columns: ['patientImageId'],
      references: 'patients_images',
      onDelete: 'CASCADE',
    },
  ],
};

export const baselineMigration: Migration = {
  name: '202609280000-baseline-schema',
  async up({ sequelize }) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(createSchemaSql, { transaction });
    });
  },
  // No `down`: reverting the baseline would drop every table and all data.
};
