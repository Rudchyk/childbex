import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../sequelize';
import { PatientImage } from './PatientImage.model';

/**
 * Provenance of "Finish review": the image had no votes and no resolution
 * when a reviewer finished the review of its Series (earlier: its cluster),
 * and so counts as NORMAL (source FINISH_REVIEW). Not a vote and not a
 * resolution: any later vote or resolution takes precedence; the record
 * itself is kept.
 */
export interface PatientImageReviewCompletionAttributes {
  id: string;
  patientImageId: string;
  /** One "Finish review" action (all images it completed share it). */
  runId: string;
  /**
   * What was finished: exactly one is set. Completions made before
   * migration 202609302100 (and by the legacy cluster endpoint) have the
   * cluster; Series Finish Review sets the series.
   */
  scopeClusterId: string | null;
  scopeSeriesId: string | null;
  completedById: string;
  completedByName: string;
  createdAt: Date;
}

export class PatientImageReviewCompletion
  extends Model<
    PatientImageReviewCompletionAttributes,
    Omit<PatientImageReviewCompletionAttributes, 'id'>
  >
  implements PatientImageReviewCompletionAttributes
{
  declare id: string;
  declare patientImageId: string;
  declare runId: string;
  declare scopeClusterId: string | null;
  declare scopeSeriesId: string | null;
  declare completedById: string;
  declare completedByName: string;
  declare createdAt: Date;
}

// Schema: migrations 202609302010-review-semantics-schema and
// 202609302100-review-completion-series-scope (CHECK: exactly one scope).
PatientImageReviewCompletion.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    patientImageId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: PatientImage, key: 'id' },
      onDelete: 'CASCADE',
    },
    runId: { type: DataTypes.UUID, allowNull: false },
    // No foreign keys: provenance only (the images reference their cluster
    // and series).
    scopeClusterId: { type: DataTypes.UUID, allowNull: true },
    scopeSeriesId: { type: DataTypes.UUID, allowNull: true },
    completedById: { type: DataTypes.STRING, allowNull: false },
    completedByName: { type: DataTypes.STRING, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'patient_image_review_completions',
    timestamps: false,
    indexes: [
      {
        name: 'patient_image_review_completions_patient_image_id',
        unique: true,
        fields: ['patientImageId'],
      },
    ],
  }
);
