import { DataTypes, Model } from 'sequelize';
import { ReviewResolutionLabel } from '@libs/schemas';
import { sequelize } from '../sequelize';
import { PatientImage } from './PatientImage.model';

/**
 * - admin: set by an admin through the API;
 * - legacy_confirmed: a legacy (unlabelled) resolution an operator gave a
 *   label to during `backfill review-state`;
 * - legacy_unlabeled: a legacy resolution an operator set aside (IGNORE);
 *   kept only as history, never active.
 */
export type ReviewResolutionOrigin =
  | 'admin'
  | 'legacy_confirmed'
  | 'legacy_unlabeled';

/**
 * Explicit resolutions of an image's review. Append-only: a new resolution
 * (or its removal) supersedes the active one, which is kept as history. At
 * most one resolution per image is active (`supersededAt` IS NULL).
 */
export interface PatientImageReviewResolutionAttributes {
  id: string;
  patientImageId: string;
  /** Null only for a set-aside legacy resolution (never active). */
  label: ReviewResolutionLabel | null;
  origin: ReviewResolutionOrigin;
  /** Null for a legacy resolution whose resolver was not recorded. */
  resolverId: string | null;
  resolverName: string | null;
  /** Free text: never log it. */
  comment: string | null;
  /** Legacy only: when the legacy resolution was made (if recorded). */
  legacyResolvedAt: Date | null;
  /** Legacy only: the operator who confirmed / set aside the resolution. */
  confirmedByName: string | null;
  createdAt: Date;
  supersededAt: Date | null;
  supersededById: string | null;
  supersededByName: string | null;
}

export type PatientImageReviewResolutionCreationAttributes = Omit<
  PatientImageReviewResolutionAttributes,
  | 'id'
  | 'legacyResolvedAt'
  | 'confirmedByName'
  | 'supersededAt'
  | 'supersededById'
  | 'supersededByName'
> &
  Partial<
    Pick<
      PatientImageReviewResolutionAttributes,
      | 'legacyResolvedAt'
      | 'confirmedByName'
      | 'supersededAt'
      | 'supersededById'
      | 'supersededByName'
    >
  >;

export class PatientImageReviewResolution
  extends Model<
    PatientImageReviewResolutionAttributes,
    PatientImageReviewResolutionCreationAttributes
  >
  implements PatientImageReviewResolutionAttributes
{
  declare id: string;
  declare patientImageId: string;
  declare label: ReviewResolutionLabel | null;
  declare origin: ReviewResolutionOrigin;
  declare resolverId: string | null;
  declare resolverName: string | null;
  declare comment: string | null;
  declare legacyResolvedAt: Date | null;
  declare confirmedByName: string | null;
  declare createdAt: Date;
  declare supersededAt: Date | null;
  declare supersededById: string | null;
  declare supersededByName: string | null;
}

// Schema: migration 202609302010-review-semantics-schema (CHECK constraints
// there enforce the origin rules). Written only by review.service.ts and
// the review-state backfill.
PatientImageReviewResolution.init(
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
    label: { type: DataTypes.STRING(16), allowNull: true },
    origin: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'admin',
    },
    resolverId: { type: DataTypes.STRING, allowNull: true },
    resolverName: { type: DataTypes.STRING, allowNull: true },
    comment: { type: DataTypes.TEXT, allowNull: true },
    legacyResolvedAt: { type: DataTypes.DATE, allowNull: true },
    confirmedByName: { type: DataTypes.STRING, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false },
    supersededAt: { type: DataTypes.DATE, allowNull: true },
    supersededById: { type: DataTypes.STRING, allowNull: true },
    supersededByName: { type: DataTypes.STRING, allowNull: true },
  },
  {
    sequelize,
    tableName: 'patient_image_review_resolutions',
    timestamps: false,
    indexes: [
      {
        name: 'patient_image_review_resolutions_one_active',
        unique: true,
        fields: ['patientImageId'],
        where: { supersededAt: null },
      },
      {
        name: 'patient_image_review_resolutions_patient_image_id',
        fields: ['patientImageId'],
      },
    ],
  }
);
