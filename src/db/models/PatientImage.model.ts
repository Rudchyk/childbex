import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '@/db';
import { PatientImageModelAttributes, PatientImageTypes } from '@/types';
import { PatientModel } from './Patient.model';
import fs from 'fs';

export * from '@/types/lib/PatientImage.types';

type PatientImageModelCreationAttributes = Optional<
  PatientImageModelAttributes,
  'id' | 'type'
>;

export class PatientImageModel
  extends Model<
    PatientImageModelAttributes,
    PatientImageModelCreationAttributes
  >
  implements PatientImageModelAttributes
{
  declare id: string;
  declare source: string;
  declare type: PatientImageTypes;
  declare patient_id: string;
  declare notes?: string;
}

PatientImageModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    patient_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: PatientModel,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM(...Object.values(PatientImageTypes)),
      allowNull: false,
      defaultValue: PatientImageTypes.NORMAL,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'patients_images',
    timestamps: false,
    hooks: {
      afterDestroy({ source }) {
        fs.unlinkSync(source);
      },
    },
  }
);

PatientModel.hasMany(PatientImageModel, {
  foreignKey: 'patient_id',
  as: 'images',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImageModel.belongsTo(PatientModel, {
  foreignKey: 'patient_id',
  as: 'patient',
});
