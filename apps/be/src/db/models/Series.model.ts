import { DataTypes, Model, type ForeignKey } from 'sequelize';
import { sequelize } from '../sequelize';
import { Study } from './Study.model';
import { timestampFields } from '../helpers/timestamps';

/**
 * A DICOM series (backend-internal; not part of the API yet). Descriptive
 * fields are only set when all its images agree on them.
 */
export interface SeriesAttributes {
  id: string;
  studyId: string;
  /** Identity of the series (globally unique). */
  seriesInstanceUid: string;
  seriesNumber: number | null;
  /** Free text: never log it. */
  seriesDescription: string | null;
  modality: string | null;
  imageType: string[] | null;
  frameOfReferenceUid: string | null;
  convolutionKernel: string | null;
  sliceThickness: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Series extends Model<SeriesAttributes> implements SeriesAttributes {
  declare id: string;
  declare studyId: ForeignKey<Study['id']>;
  declare seriesInstanceUid: string;
  declare seriesNumber: number | null;
  declare seriesDescription: string | null;
  declare modality: string | null;
  declare imageType: string[] | null;
  declare frameOfReferenceUid: string | null;
  declare convolutionKernel: string | null;
  declare sliceThickness: number | null;

  // Sequelize‑generated:
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

// Schema: migration 202609291200-study-series. Rows are created by
// services/dicom-hierarchy.service.ts (INSERT ... ON CONFLICT).
Series.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    studyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Study, key: 'id' },
      onDelete: 'CASCADE',
    },
    seriesInstanceUid: { type: DataTypes.STRING(64), allowNull: false },
    seriesNumber: { type: DataTypes.INTEGER, allowNull: true },
    seriesDescription: { type: DataTypes.TEXT, allowNull: true },
    modality: { type: DataTypes.STRING(16), allowNull: true },
    imageType: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: true },
    frameOfReferenceUid: { type: DataTypes.STRING(64), allowNull: true },
    convolutionKernel: { type: DataTypes.TEXT, allowNull: true },
    sliceThickness: { type: DataTypes.DOUBLE, allowNull: true },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'series',
    indexes: [
      {
        name: 'series_series_instance_uid',
        unique: true,
        fields: ['seriesInstanceUid'],
      },
      { name: 'series_study_id', fields: ['studyId'] },
    ],
  }
);

// The database cascades from the study; no Sequelize-side cascade.
Series.belongsTo(Study, {
  foreignKey: 'studyId',
  as: 'study',
  onDelete: 'CASCADE',
});
