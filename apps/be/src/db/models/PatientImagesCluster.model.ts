import {
  Association,
  DataTypes,
  ForeignKey,
  HasManyGetAssociationsMixin,
  Model,
} from 'sequelize';
import { sequelize } from '../sequelize';
import { Patient } from './Patient.model/Patient.model';
import { PatientImage } from './PatientImage.model';
import { PatientImagesCluster as IPatientImagesCluster } from '@libs/schemas';
import { timestampFields } from '../helpers/timestamps';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { uploadRoot } from '../../services/patients.service';

export type PatientImagesClusterCreationAttributes = Omit<
  IPatientImagesCluster,
  'id' | 'inReview' | 'createdAt' | 'updatedAt'
>;

export class PatientImagesCluster
  extends Model<IPatientImagesCluster, PatientImagesClusterCreationAttributes>
  implements IPatientImagesCluster
{
  declare id: IPatientImagesCluster['id'];
  declare cluster: IPatientImagesCluster['cluster'];
  declare name: IPatientImagesCluster['name'];
  declare patientId: ForeignKey<Patient['id']>;
  declare notes: IPatientImagesCluster['notes'];
  declare studyDate: IPatientImagesCluster['studyDate'];
  declare inReview: IPatientImagesCluster['inReview'];

  // Sequelize‑generated:
  declare readonly createdAt: IPatientImagesCluster['createdAt'];
  declare readonly updatedAt: IPatientImagesCluster['updatedAt'];

  declare getImages: HasManyGetAssociationsMixin<PatientImagesCluster>;
  declare getPatient: HasManyGetAssociationsMixin<Patient>;

  declare static associations: {
    images: Association<PatientImagesCluster, PatientImage>;
    patient: Association<PatientImagesCluster, Patient>;
  };
}

PatientImagesCluster.init(
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
    tableName: 'patient_images_clusters',
    indexes: [
      {
        unique: true,
        fields: ['cluster', 'patientId', 'studyDate'],
      },
    ],
    hooks: {
      async afterDestroy(cluster) {
        const destDir = path.join(uploadRoot, cluster.patientId, cluster.id);
        try {
          await access(destDir);
          await rm(destDir, {
            recursive: true,
            force: true,
            maxRetries: 3, // optional (helps on Windows)
            retryDelay: 100, // optional (ms)
          });
        } catch {
          return;
        }
      },
    },
  }
);

Patient.hasMany(PatientImagesCluster, {
  foreignKey: 'patientId',
  as: 'clusters',
  onDelete: 'CASCADE',
  hooks: true,
});

PatientImagesCluster.belongsTo(Patient, {
  foreignKey: 'patientId',
  as: 'patient',
});
