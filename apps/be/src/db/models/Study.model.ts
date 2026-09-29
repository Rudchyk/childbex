import { DataTypes, Model, type ForeignKey } from 'sequelize';
import { sequelize } from '../sequelize';
import { Patient } from './Patient.model';
import { timestampFields } from '../helpers/timestamps';

/** A DICOM study (backend-internal; not part of the API yet). */
export interface StudyAttributes {
  id: string;
  patientId: string;
  /** Identity of the study (globally unique). */
  studyInstanceUid: string;
  /** DICOM StudyDate as `YYYY-MM-DD` (no time zone). */
  studyDate: string | null;
  /** DICOM StudyTime exactly as recorded. */
  studyTime: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Study extends Model<StudyAttributes> implements StudyAttributes {
  declare id: string;
  declare patientId: ForeignKey<Patient['id']>;
  declare studyInstanceUid: string;
  declare studyDate: string | null;
  declare studyTime: string | null;

  // Sequelize‑generated:
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;
}

// Schema: migration 202609291200-study-series. Rows are created by
// services/dicom-hierarchy.service.ts (INSERT ... ON CONFLICT).
Study.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    patientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Patient, key: 'id' },
      onDelete: 'CASCADE',
    },
    studyInstanceUid: { type: DataTypes.STRING(64), allowNull: false },
    studyDate: { type: DataTypes.DATEONLY, allowNull: true },
    studyTime: { type: DataTypes.STRING(16), allowNull: true },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'studies',
    indexes: [
      {
        name: 'studies_study_instance_uid',
        unique: true,
        fields: ['studyInstanceUid'],
      },
      { name: 'studies_patient_id', fields: ['patientId'] },
    ],
  }
);

// The database cascades from the patient; no Sequelize-side cascade.
Study.belongsTo(Patient, {
  foreignKey: 'patientId',
  as: 'patient',
  onDelete: 'CASCADE',
});
