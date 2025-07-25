import {
  DataTypes,
  Model,
  Op,
  InferAttributes,
  InferCreationAttributes,
} from 'sequelize';
import { sequelize } from '@/db';
import { Patient as PatientAttributes } from '@/types';
import { timestampFields } from '../helpers/timestamps';
import { User } from './User.model';
import { toSlugIfCyr } from '@/lib/utils';

export class Patient
  extends Model<
    InferAttributes<Patient>,
    InferCreationAttributes<
      Patient,
      {
        omit: 'id' | 'createdAt' | 'updatedAt' | 'deletedAt';
      }
    >
  >
  implements PatientAttributes
{
  declare id: PatientAttributes['id'];
  declare name: PatientAttributes['name'];
  declare slug: PatientAttributes['slug'];
  declare notes: PatientAttributes['notes'];
  declare creatorId: PatientAttributes['creatorId'];

  // Sequelize‑generated:
  declare readonly createdAt: PatientAttributes['createdAt'];
  declare readonly updatedAt: PatientAttributes['updatedAt'];
  declare readonly deletedAt: PatientAttributes['deletedAt'];

  // Associations:
  declare clusters?: PatientAttributes['clusters'];
  declare creator?: PatientAttributes['creator'];
}

Patient.init(
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
    slug: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    creatorId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'patients',
    paranoid: true,
    timestamps: true,
    hooks: {
      beforeValidate: async (patient: Patient) => {
        if (!patient.slug) {
          const base = toSlugIfCyr(patient.name);
          const rows = await Patient.findAll({
            where: {
              slug: { [Op.like]: `${base}%` },
            },
            attributes: ['slug'],
          });

          // Збираємо всі числа із суфіксів, якщо вони є
          const nums = rows.map((r) => {
            const m = r.slug.match(new RegExp(`^${base}-(\\d+)$`));
            return m ? parseInt(m[1], 10) : 0;
          });
          const next = Math.max(...nums) + 1;

          patient.slug =
            next === 1 && !rows.some((r) => r.slug === base)
              ? base
              : `${base}-${next}`;
        }
      },
    },
  }
);

User.hasMany(Patient, {
  foreignKey: 'creatorId',
  as: 'creator',
});

Patient.belongsTo(User, {
  foreignKey: 'creatorId',
  as: 'creator',
});
