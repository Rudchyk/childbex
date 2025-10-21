import {
  DataTypes,
  Model,
  Op,
  Association,
  NonAttribute,
  // Association,
} from 'sequelize';
import { sequelize } from '../sequelize';
import { PatientCreationAttributes, Patient as IPatient } from '@libs/schemas';
import { timestampFields, deletedAtPropertyField } from '../helpers/timestamps';
// import { PatientImageCluster } from './PatientImageCluster.model';
import slug from 'slug';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
//@ts-ignore
import { isHasCyrillic } from 'cyrillic-doctor';

slug.setLocale('uk');
export class Patient
  extends Model<
    IPatient,
    Omit<PatientCreationAttributes, 'notes' | 'slug'> &
      Partial<Pick<PatientCreationAttributes, 'notes' | 'slug'>>
  >
  implements Patient
{
  declare id: IPatient['id'];
  declare name: IPatient['name'];
  declare slug: IPatient['slug'];
  declare notes: IPatient['notes'];
  declare creatorId: IPatient['creatorId'];

  // Sequelize‑generated:
  declare readonly createdAt: IPatient['createdAt'];
  declare readonly updatedAt: IPatient['updatedAt'];
  declare readonly deletedAt: IPatient['deletedAt'];

  declare static associations: {
    clusters: Association<Patient, any>;
  };

  // Associations:
  declare clusters?: NonAttribute<IPatient['clusters']>;
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
      type: DataTypes.STRING,
      allowNull: false,
    },
    creatorName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    ...timestampFields,
    ...deletedAtPropertyField,
  },
  {
    sequelize,
    tableName: 'patients',
    paranoid: true,
    timestamps: true,
    hooks: {
      beforeValidate: async (patient) => {
        const base =
          patient.slug ||
          (isHasCyrillic(patient.name)
            ? slug(patient.name)
            : slug(patient.name, { lower: true }));
        const rows = await Patient.findAll({
          where: {
            slug: { [Op.like]: `${base}%` },
          },
          attributes: ['slug'],
        });

        if (rows.length) {
          // Збираємо всі числа із суфіксів, якщо вони є
          const nums = rows.map((r) => {
            const m = r.slug.match(new RegExp(`^${base}-(\\d+)$`));
            return m ? parseInt(m[1], 10) : 0;
          });
          if (nums.length) {
            const next = Math.max(...nums) + 1;
            const newSlug =
              next === 1 && !rows.some((r) => r.slug === base)
                ? base
                : `${base}-${next}`;
            patient.slug = newSlug;
          }
        } else {
          if (!patient.slug) {
            patient.slug = base;
          }
        }
      },
    },
  }
);
