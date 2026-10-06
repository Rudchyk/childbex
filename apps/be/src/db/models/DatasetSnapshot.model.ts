import { DataTypes, Model } from 'sequelize';
import type {
  DatasetExclusionReason,
  DatasetLabel,
  DatasetPatientStratum,
  DatasetReviewSource,
  DatasetSnapshotConfigV1,
  DatasetSnapshotStatus,
  DatasetSplit,
} from '@libs/schemas';
import { sequelize } from '../sequelize';
import { PatientImage } from './PatientImage.model';
import { ReviewFreeze } from './ReviewFreeze.model';
import { timestampFields } from '../helpers/timestamps';

/**
 * ML dataset snapshots (schema: migration 202610020000-dataset-snapshots,
 * whose triggers make finalized data immutable). Written only by
 * services/dataset-snapshot.
 */
export interface DatasetSnapshotAttributes {
  id: string;
  name: string;
  description: string | null;
  status: DatasetSnapshotStatus;
  datasetSchemaVersion: number;
  configuration: DatasetSnapshotConfigV1;
  splitSeed: string;
  createdById: string;
  createdByName: string;
  finalizedAt: Date | null;
  finalizedById: string | null;
  finalizedByName: string | null;
  archivedAt: Date | null;
  archivedById: string | null;
  archivedByName: string | null;
  /** The review freeze the snapshot was finalized under. */
  reviewFreezeId: string | null;
  fileVerification: 'SHA256_REHASHED' | null;
  totalPatients: number | null;
  totalImages: number | null;
  normalImages: number | null;
  abnormalImages: number | null;
  excludedImages: number | null;
  exclusionSummary: Record<string, number> | null;
  createdAt: Date;
  updatedAt: Date;
}

type Optional =
  | 'id'
  | 'description'
  | 'status'
  | 'finalizedAt'
  | 'finalizedById'
  | 'finalizedByName'
  | 'archivedAt'
  | 'archivedById'
  | 'archivedByName'
  | 'reviewFreezeId'
  | 'fileVerification'
  | 'totalPatients'
  | 'totalImages'
  | 'normalImages'
  | 'abnormalImages'
  | 'excludedImages'
  | 'exclusionSummary'
  | 'createdAt'
  | 'updatedAt';

export class DatasetSnapshot
  extends Model<
    DatasetSnapshotAttributes,
    Omit<DatasetSnapshotAttributes, Optional> & Partial<Pick<DatasetSnapshotAttributes, Optional>>
  >
  implements DatasetSnapshotAttributes
{
  declare id: string;
  declare name: string;
  declare description: string | null;
  declare status: DatasetSnapshotStatus;
  declare datasetSchemaVersion: number;
  declare configuration: DatasetSnapshotConfigV1;
  declare splitSeed: string;
  declare createdById: string;
  declare createdByName: string;
  declare finalizedAt: Date | null;
  declare finalizedById: string | null;
  declare finalizedByName: string | null;
  declare archivedAt: Date | null;
  declare archivedById: string | null;
  declare archivedByName: string | null;
  declare reviewFreezeId: string | null;
  declare fileVerification: 'SHA256_REHASHED' | null;
  declare totalPatients: number | null;
  declare totalImages: number | null;
  declare normalImages: number | null;
  declare abnormalImages: number | null;
  declare excludedImages: number | null;
  declare exclusionSummary: Record<string, number> | null;
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

DatasetSnapshot.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    name: { type: DataTypes.STRING(200), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'DRAFT' },
    datasetSchemaVersion: { type: DataTypes.INTEGER, allowNull: false },
    configuration: { type: DataTypes.JSONB, allowNull: false },
    splitSeed: { type: DataTypes.TEXT, allowNull: false },
    createdById: { type: DataTypes.STRING, allowNull: false },
    createdByName: { type: DataTypes.STRING, allowNull: false },
    finalizedAt: { type: DataTypes.DATE, allowNull: true },
    finalizedById: { type: DataTypes.STRING, allowNull: true },
    finalizedByName: { type: DataTypes.STRING, allowNull: true },
    archivedAt: { type: DataTypes.DATE, allowNull: true },
    archivedById: { type: DataTypes.STRING, allowNull: true },
    archivedByName: { type: DataTypes.STRING, allowNull: true },
    reviewFreezeId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: ReviewFreeze, key: 'id' },
      onDelete: 'RESTRICT',
    },
    fileVerification: { type: DataTypes.STRING(32), allowNull: true },
    totalPatients: { type: DataTypes.INTEGER, allowNull: true },
    totalImages: { type: DataTypes.INTEGER, allowNull: true },
    normalImages: { type: DataTypes.INTEGER, allowNull: true },
    abnormalImages: { type: DataTypes.INTEGER, allowNull: true },
    excludedImages: { type: DataTypes.INTEGER, allowNull: true },
    exclusionSummary: { type: DataTypes.JSONB, allowNull: true },
    ...timestampFields,
  },
  { sequelize, tableName: 'dataset_snapshots' }
);

export interface DatasetSnapshotPatientAttributes {
  snapshotId: string;
  /** Patient grouping key (Patient.id for now; a future de-identified key). */
  patientGroupKey: string;
  patientId: string;
  split: DatasetSplit;
  stratum: DatasetPatientStratum;
  splitRank: string;
  imageCount: number;
  normalImages: number;
  abnormalImages: number;
}

export class DatasetSnapshotPatient
  extends Model<DatasetSnapshotPatientAttributes>
  implements DatasetSnapshotPatientAttributes
{
  declare snapshotId: string;
  declare patientGroupKey: string;
  declare patientId: string;
  declare split: DatasetSplit;
  declare stratum: DatasetPatientStratum;
  declare splitRank: string;
  declare imageCount: number;
  declare normalImages: number;
  declare abnormalImages: number;
}

DatasetSnapshotPatient.init(
  {
    snapshotId: {
      type: DataTypes.UUID,
      allowNull: false,
      primaryKey: true,
      references: { model: DatasetSnapshot, key: 'id' },
      onDelete: 'CASCADE',
    },
    patientGroupKey: { type: DataTypes.STRING(128), allowNull: false, primaryKey: true },
    patientId: { type: DataTypes.UUID, allowNull: false },
    split: { type: DataTypes.STRING(16), allowNull: false },
    stratum: { type: DataTypes.STRING(16), allowNull: false },
    splitRank: { type: DataTypes.CHAR(64), allowNull: false },
    imageCount: { type: DataTypes.INTEGER, allowNull: false },
    normalImages: { type: DataTypes.INTEGER, allowNull: false },
    abnormalImages: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    sequelize,
    tableName: 'dataset_snapshot_patients',
    timestamps: false,
    indexes: [
      {
        name: 'dataset_snapshot_patients_split_key',
        unique: true,
        fields: ['snapshotId', 'patientGroupKey', 'split'],
      },
    ],
  }
);

export interface DatasetSnapshotItemAttributes {
  id: string;
  snapshotId: string;
  patientGroupKey: string;
  split: DatasetSplit;
  patientImageId: string;
  patientId: string;
  studyId: string;
  seriesId: string;
  label: DatasetLabel;
  reviewStateAtSnapshot: string;
  reviewStateSourceAtSnapshot: DatasetReviewSource;
  reviewResolutionId: string | null;
  reviewCompletionId: string | null;
  normalVotes: number;
  abnormalVotes: number;
  uncertainVotes: number;
  /**
   * Implicit NORMAL opinions (reviewers' completed Series reviews without a
   * vote on the image) the label was derived from; 0 before migration
   * 202610050000.
   */
  implicitNormals: number;
  seriesOrderIndex: number;
  fileSha256: string;
  /** BIGINT: read back as a string by the pg driver. */
  fileSize: string | number;
  createdAt: Date;
}

export class DatasetSnapshotItem
  extends Model<DatasetSnapshotItemAttributes, Omit<DatasetSnapshotItemAttributes, 'id'>>
  implements DatasetSnapshotItemAttributes
{
  declare id: string;
  declare snapshotId: string;
  declare patientGroupKey: string;
  declare split: DatasetSplit;
  declare patientImageId: string;
  declare patientId: string;
  declare studyId: string;
  declare seriesId: string;
  declare label: DatasetLabel;
  declare reviewStateAtSnapshot: string;
  declare reviewStateSourceAtSnapshot: DatasetReviewSource;
  declare reviewResolutionId: string | null;
  declare reviewCompletionId: string | null;
  declare normalVotes: number;
  declare abnormalVotes: number;
  declare uncertainVotes: number;
  declare implicitNormals: number;
  declare seriesOrderIndex: number;
  declare fileSha256: string;
  declare fileSize: string | number;
  declare createdAt: Date;
}

// The composite FK (snapshotId, patientGroupKey, split) -> patients exists
// only in the migration (Sequelize cannot declare it).
DatasetSnapshotItem.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    snapshotId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: DatasetSnapshot, key: 'id' },
      onDelete: 'CASCADE',
    },
    patientGroupKey: { type: DataTypes.STRING(128), allowNull: false },
    split: { type: DataTypes.STRING(16), allowNull: false },
    // Source images of a finalized snapshot cannot be deleted.
    patientImageId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: PatientImage, key: 'id' },
      onDelete: 'RESTRICT',
    },
    patientId: { type: DataTypes.UUID, allowNull: false },
    studyId: { type: DataTypes.UUID, allowNull: false },
    seriesId: { type: DataTypes.UUID, allowNull: false },
    label: { type: DataTypes.STRING(16), allowNull: false },
    reviewStateAtSnapshot: { type: DataTypes.STRING(16), allowNull: false },
    reviewStateSourceAtSnapshot: { type: DataTypes.STRING(16), allowNull: false },
    reviewResolutionId: { type: DataTypes.UUID, allowNull: true },
    reviewCompletionId: { type: DataTypes.UUID, allowNull: true },
    normalVotes: { type: DataTypes.INTEGER, allowNull: false },
    abnormalVotes: { type: DataTypes.INTEGER, allowNull: false },
    uncertainVotes: { type: DataTypes.INTEGER, allowNull: false },
    // Migration 202610050000-series-review-completions.
    implicitNormals: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    seriesOrderIndex: { type: DataTypes.INTEGER, allowNull: false },
    fileSha256: { type: DataTypes.CHAR(64), allowNull: false },
    fileSize: { type: DataTypes.BIGINT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'dataset_snapshot_items',
    timestamps: false,
    indexes: [
      {
        name: 'dataset_snapshot_items_snapshot_image',
        unique: true,
        fields: ['snapshotId', 'patientImageId'],
      },
      { name: 'dataset_snapshot_items_patient_image_id', fields: ['patientImageId'] },
    ],
  }
);

export interface DatasetSnapshotExclusionAttributes {
  id: string;
  snapshotId: string;
  patientImageId: string;
  seriesId: string;
  patientGroupKey: string;
  reason: DatasetExclusionReason;
  /**
   * Review provenance at the snapshot (why the image got no label, e.g. the
   * opinions behind CONFLICTED); null before migration 202610050000.
   */
  reviewStateAtSnapshot: string | null;
  reviewStateSourceAtSnapshot: string | null;
  normalVotes: number | null;
  abnormalVotes: number | null;
  uncertainVotes: number | null;
  implicitNormals: number | null;
  createdAt: Date;
}

export class DatasetSnapshotExclusion
  extends Model<DatasetSnapshotExclusionAttributes, Omit<DatasetSnapshotExclusionAttributes, 'id'>>
  implements DatasetSnapshotExclusionAttributes
{
  declare id: string;
  declare snapshotId: string;
  declare patientImageId: string;
  declare seriesId: string;
  declare patientGroupKey: string;
  declare reason: DatasetExclusionReason;
  declare reviewStateAtSnapshot: string | null;
  declare reviewStateSourceAtSnapshot: string | null;
  declare normalVotes: number | null;
  declare abnormalVotes: number | null;
  declare uncertainVotes: number | null;
  declare implicitNormals: number | null;
  declare createdAt: Date;
}

// No FK to the image: an exclusion is an audit record only.
DatasetSnapshotExclusion.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    snapshotId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: DatasetSnapshot, key: 'id' },
      onDelete: 'CASCADE',
    },
    patientImageId: { type: DataTypes.UUID, allowNull: false },
    seriesId: { type: DataTypes.UUID, allowNull: false },
    patientGroupKey: { type: DataTypes.STRING(128), allowNull: false },
    reason: { type: DataTypes.STRING(32), allowNull: false },
    // Migration 202610050000-series-review-completions.
    reviewStateAtSnapshot: { type: DataTypes.STRING(16), allowNull: true },
    reviewStateSourceAtSnapshot: { type: DataTypes.STRING(16), allowNull: true },
    normalVotes: { type: DataTypes.INTEGER, allowNull: true },
    abnormalVotes: { type: DataTypes.INTEGER, allowNull: true },
    uncertainVotes: { type: DataTypes.INTEGER, allowNull: true },
    implicitNormals: { type: DataTypes.INTEGER, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'dataset_snapshot_exclusions',
    timestamps: false,
    indexes: [
      {
        name: 'dataset_snapshot_exclusions_snapshot_image',
        unique: true,
        fields: ['snapshotId', 'patientImageId'],
      },
    ],
  }
);
