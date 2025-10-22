import {
  Association,
  DataTypes,
  ForeignKey,
  Model,
  NonAttribute,
} from 'sequelize';
import { sequelize } from '../sequelize';
import { Patient } from './Patient.model';
import { PatientImage } from './PatientImage.model';
import { PatientImageCluster as IPatientImageCluster } from '@libs/schemas';
import { timestampFields } from '../helpers/timestamps';

export type PatientImageClusterCreationAttributes = Omit<
  IPatientImageCluster,
  'id' | 'inReview' | 'createdAt' | 'updatedAt'
>;

export class PatientImageCluster
  extends Model<IPatientImageCluster, PatientImageClusterCreationAttributes>
  implements IPatientImageCluster
{
  declare id: IPatientImageCluster['id'];
  declare cluster: IPatientImageCluster['cluster'];
  declare name: IPatientImageCluster['name'];
  declare patientId: ForeignKey<Patient['id']>;
  declare notes: IPatientImageCluster['notes'];
  declare studyDate: IPatientImageCluster['studyDate'];
  declare inReview: IPatientImageCluster['inReview'];

  // Sequelize‑generated:
  declare readonly createdAt: IPatientImageCluster['createdAt'];
  declare readonly updatedAt: IPatientImageCluster['updatedAt'];

  declare static associations: {
    images: Association<PatientImageCluster, PatientImage>;
    patient: Association<PatientImageCluster, Patient>;
  };

  // Associations:
  declare images?: NonAttribute<IPatientImageCluster['images']>;
  declare patient?: NonAttribute<IPatientImageCluster['patient']>;
}

PatientImageCluster.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    cluster: {
      type: DataTypes.INTEGER,
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
    studyDate: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    inReview: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'patient_image_clusters',
    indexes: [
      {
        unique: true,
        fields: ['cluster', 'patientId', 'studyDate'],
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
  as: 'patient',
});
