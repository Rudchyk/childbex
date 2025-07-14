import { DataTypes, FindOptions, Model, Optional } from 'sequelize';
import { sequelize } from '@/db';
import { ExtendedPatient, PatientModelAttributes } from '@/types';
import { UserModel } from './User.model';
import path from 'path';
import fs from 'fs';
import { UPLOAD_ROOT } from '@/lib/constants/constants';

export * from '@/types/lib/Patient.types';

type PatientModelCreationAttributes = Optional<PatientModelAttributes, 'id'>;

export class PatientModel
  extends Model<PatientModelAttributes, PatientModelCreationAttributes>
  implements PatientModelAttributes
{
  declare id: string;
  declare name: string;
  declare slug: string;
  declare notes: string;
  declare creator_id: string;

  static async findExtendedPatients(
    props?: FindOptions<PatientModelAttributes>
  ): Promise<ExtendedPatient[]> {
    const result = await this.findAll({
      ...props,
      include: [
        {
          model: UserModel,
          as: 'creator',
        },
      ],
    });
    return result.map((r) => {
      const patient = r.toJSON() as ExtendedPatient;
      const imagesPath = path.join(UPLOAD_ROOT, patient.slug);
      const imagesList = fs.readdirSync(imagesPath);
      return {
        ...patient,
        images: imagesList.map((imageName) => path.join(imagesPath, imageName)),
      };
    });
  }

  static async findExtendedPatient(
    slug: PatientModelAttributes['slug']
  ): Promise<ExtendedPatient | undefined> {
    const result = await this.findOne({
      where: {
        slug,
      },
      include: [
        {
          model: UserModel,
          as: 'creator',
        },
      ],
    });

    if (!result) {
      return;
    }

    const imagesPath = path.join(UPLOAD_ROOT, slug);
    const imagesList = fs.readdirSync(imagesPath);

    return {
      ...(result.toJSON() as ExtendedPatient),
      images: imagesList.map((imageName) => `/uploads/${slug}/${imageName}`),
    };
  }
}

PatientModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    creator_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    name: { type: DataTypes.STRING, allowNull: false },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'patients',
    paranoid: true,
  }
);

UserModel.hasMany(PatientModel, {
  foreignKey: 'creator_id',
  as: 'creator',
});

PatientModel.belongsTo(UserModel, {
  foreignKey: 'creator_id',
  as: 'creator',
});
