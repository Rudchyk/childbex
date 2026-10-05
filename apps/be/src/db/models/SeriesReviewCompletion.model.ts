import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../sequelize';
import { Series } from './Series.model';

/**
 * A reviewer's "Complete review" of a DICOM Series (append-only history).
 *
 * The latest completion of a reviewer for a Series means: every image in
 * `imageIds` the reviewer did not vote on is NORMAL according to that
 * reviewer (an implicit NORMAL opinion; not a vote row). It is a record of a
 * completed review pass, not a lock: the reviewer can vote on any image
 * later, and the explicit vote takes precedence over the implicit opinion.
 */
export interface SeriesReviewCompletionAttributes {
  id: string;
  seriesId: string;
  reviewerId: string;
  reviewerName: string;
  /** The non-broken images the reviewer was shown (validated, sorted). */
  imageIds: string[];
  imageCount: number;
  /** Image-set revision: SHA-256 of the sorted image ids (see review.service). */
  imageSetHash: string;
  completedAt: Date;
}

export class SeriesReviewCompletion
  extends Model<
    SeriesReviewCompletionAttributes,
    Omit<SeriesReviewCompletionAttributes, 'id'>
  >
  implements SeriesReviewCompletionAttributes
{
  declare id: string;
  declare seriesId: string;
  declare reviewerId: string;
  declare reviewerName: string;
  declare imageIds: string[];
  declare imageCount: number;
  declare imageSetHash: string;
  declare completedAt: Date;
}

// Schema: migration 202610050000-series-review-completions. Written only by
// services/review.service.ts.
SeriesReviewCompletion.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    seriesId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Series, key: 'id' },
      onDelete: 'CASCADE',
    },
    reviewerId: { type: DataTypes.STRING, allowNull: false },
    reviewerName: { type: DataTypes.STRING, allowNull: false },
    imageIds: { type: DataTypes.ARRAY(DataTypes.UUID), allowNull: false },
    imageCount: { type: DataTypes.INTEGER, allowNull: false },
    imageSetHash: { type: DataTypes.CHAR(64), allowNull: false },
    completedAt: { type: DataTypes.DATE, allowNull: false },
  },
  {
    sequelize,
    tableName: 'series_review_completions',
    timestamps: false,
    indexes: [
      {
        name: 'series_review_completions_series_reviewer',
        fields: ['seriesId', 'reviewerId', { name: 'completedAt', order: 'DESC' }],
      },
    ],
  }
);
