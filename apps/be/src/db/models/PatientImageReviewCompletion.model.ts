import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../sequelize';
import { PatientImage } from './PatientImage.model';

/**
 * Provenance of "Finish review": the image had no votes and no resolution
 * when a reviewer finished the review of its cluster, and so counts as
 * NORMAL (source FINISH_REVIEW). Not a vote and not a resolution: any later
 * vote or resolution takes precedence; the record itself is kept.
 */
export interface PatientImageReviewCompletionAttributes {
  id: string;
  patientImageId: string;
  /** One "Finish review" action (all images it completed share it). */
  runId: string;
  /** The cluster whose review was finished. */
  scopeClusterId: string;
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
  declare scopeClusterId: string;
  declare completedById: string;
  declare completedByName: string;
  declare createdAt: Date;
}

// Schema: migration 202609302010-review-semantics-schema.
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
    // No foreign key: provenance only (the images reference their cluster).
    scopeClusterId: { type: DataTypes.UUID, allowNull: false },
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
