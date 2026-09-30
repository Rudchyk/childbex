import { DataTypes, Model } from 'sequelize';
import { PatientImageReviewVoteTypes } from '@libs/schemas';
import { sequelize } from '../sequelize';
import { PatientImage } from './PatientImage.model';

export type ReviewVoteEventAction = 'cast' | 'changed';

/** Append-only history of review votes (who voted what, and when). */
export interface PatientImageReviewVoteEventAttributes {
  id: string;
  patientImageId: string;
  reviewerId: string;
  reviewerName: string;
  action: ReviewVoteEventAction;
  previousVote: PatientImageReviewVoteTypes | null;
  newVote: PatientImageReviewVoteTypes;
  previousComment: string | null;
  newComment: string | null;
  createdAt: Date;
}

export class PatientImageReviewVoteEvent
  extends Model<
    PatientImageReviewVoteEventAttributes,
    Omit<PatientImageReviewVoteEventAttributes, 'id'>
  >
  implements PatientImageReviewVoteEventAttributes
{
  declare id: string;
  declare patientImageId: string;
  declare reviewerId: string;
  declare reviewerName: string;
  declare action: ReviewVoteEventAction;
  declare previousVote: PatientImageReviewVoteTypes | null;
  declare newVote: PatientImageReviewVoteTypes;
  declare previousComment: string | null;
  declare newComment: string | null;
  declare createdAt: Date;
}

// Schema: migration 202609302010-review-semantics-schema. Written only by
// services/review.service.ts.
PatientImageReviewVoteEvent.init(
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
    reviewerId: { type: DataTypes.STRING, allowNull: false },
    reviewerName: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING(16), allowNull: false },
    previousVote: { type: DataTypes.STRING(16), allowNull: true },
    newVote: { type: DataTypes.STRING(16), allowNull: false },
    previousComment: { type: DataTypes.TEXT, allowNull: true },
    newComment: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'patient_image_review_vote_events',
    timestamps: false,
    indexes: [
      {
        name: 'patient_image_review_vote_events_patient_image_id',
        fields: ['patientImageId'],
      },
    ],
  }
);
