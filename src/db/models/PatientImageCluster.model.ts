import {
  // Association,
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize';
import { sequelize } from '@/db';
import { Patient } from './Patient.model';
import { PatientImageCluster as PatientImageClusterAttributes } from '@/types';
import { basicTimestampFields } from '../helpers/timestamps';

export type PatientImageClusterCreationAttributes = InferCreationAttributes<
  PatientImageCluster,
  {
    omit: 'inReview' | 'createdAt' | 'updatedAt';
  }
>;

export class PatientImageCluster
  extends Model<
    InferAttributes<PatientImageCluster>,
    PatientImageClusterCreationAttributes
  >
  implements PatientImageClusterAttributes
{
  declare id: PatientImageClusterAttributes['id'];
  declare name: PatientImageClusterAttributes['name'];
  declare patientId: PatientImageClusterAttributes['patientId'];
  declare notes: PatientImageClusterAttributes['notes'];
  declare inReview: PatientImageClusterAttributes['inReview'];

  // Sequelize‑generated:
  declare readonly createdAt: PatientImageClusterAttributes['createdAt'];
  declare readonly updatedAt: PatientImageClusterAttributes['updatedAt'];

  // declare static associations: {
  //   images: Association<PatientImageCluster, PatientImageModel>;
  //   patient: Association<PatientImageCluster, Patient>;
  // };

  // Associations:
  declare images?: PatientImageClusterAttributes['images'];
  declare patient?: PatientImageClusterAttributes['patient'];
}

PatientImageCluster.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    patientId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Patient,
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    inReview: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
    ...basicTimestampFields,
  },
  {
    sequelize,
    tableName: 'patient_image_clusters',
    indexes: [
      {
        unique: true,
        fields: ['id', 'patientId'],
      },
    ],
  }
);

Patient.hasMany(PatientImageCluster, {
  foreignKey: 'patientId',
  as: 'clusters',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImageCluster.belongsTo(Patient, {
  foreignKey: 'patientId',
  as: 'clusters',
});
