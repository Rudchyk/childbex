import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../sequelize';

/**
 * Review freezes. A manual freeze (admin) is active until unfrozen
 * (`unfrozenAt` IS NULL); while one is active no review data can change.
 * A dataset snapshot finalization records the short window its labels were
 * captured in as a closed row (frozen and unfrozen by the finalizer) when
 * no manual freeze was active. Rows are kept as history.
 */
export interface ReviewFreezeAttributes {
  id: string;
  scope: 'global';
  /** Free text: never log it. */
  reason: string;
  frozenById: string;
  frozenByName: string;
  frozenAt: Date;
  unfrozenAt: Date | null;
  unfrozenById: string | null;
  unfrozenByName: string | null;
}

export class ReviewFreeze
  extends Model<
    ReviewFreezeAttributes,
    Omit<
      ReviewFreezeAttributes,
      'id' | 'scope' | 'unfrozenAt' | 'unfrozenById' | 'unfrozenByName'
    > &
      Partial<
        Pick<ReviewFreezeAttributes, 'unfrozenAt' | 'unfrozenById' | 'unfrozenByName'>
      >
  >
  implements ReviewFreezeAttributes
{
  declare id: string;
  declare scope: 'global';
  declare reason: string;
  declare frozenById: string;
  declare frozenByName: string;
  declare frozenAt: Date;
  declare unfrozenAt: Date | null;
  declare unfrozenById: string | null;
  declare unfrozenByName: string | null;
}

// Schema: migration 202609302010-review-semantics-schema.
ReviewFreeze.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    scope: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'global',
    },
    reason: { type: DataTypes.TEXT, allowNull: false },
    frozenById: { type: DataTypes.STRING, allowNull: false },
    frozenByName: { type: DataTypes.STRING, allowNull: false },
    frozenAt: { type: DataTypes.DATE, allowNull: false },
    unfrozenAt: { type: DataTypes.DATE, allowNull: true },
    unfrozenById: { type: DataTypes.STRING, allowNull: true },
    unfrozenByName: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize,
    tableName: 'review_freezes',
    timestamps: false,
    indexes: [
      {
        name: 'review_freezes_one_active',
        unique: true,
        fields: ['scope'],
        where: { unfrozenAt: null },
      },
    ],
  }
);
