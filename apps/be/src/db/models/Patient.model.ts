import {
  DataTypes,
  Model,
  Op,
  Association,
  HasManyGetAssociationsMixin,
} from 'sequelize';
import { sequelize } from '../sequelize';
import {
  PatientCreationAttributes as PatientBaseCreationAttributes,
  Patient as IPatient,
} from '@libs/schemas';
import { timestampFields, deletedAtPropertyField } from '../helpers/timestamps';
import { toSlugIfCyr } from '@libs/helpers';
import { PatientImageCluster } from './PatientImageCluster.model';

type PatientCreationAttributes = Omit<
  PatientBaseCreationAttributes,
  'notes' | 'slug'
> &
  Partial<Pick<PatientBaseCreationAttributes, 'notes' | 'slug'>>;

export class Patient
  extends Model<IPatient, PatientCreationAttributes>
  implements IPatient
{
  declare id: IPatient['id'];
  declare name: IPatient['name'];
  declare slug: IPatient['slug'];
  declare notes: IPatient['notes'];
  declare creatorId: IPatient['creatorId'];
  declare creatorName: IPatient['creatorName'];

  // Sequelize‑generated:
  declare readonly createdAt: IPatient['createdAt'];
  declare readonly updatedAt: IPatient['updatedAt'];
  declare readonly deletedAt: IPatient['deletedAt'];

  declare getClusters: HasManyGetAssociationsMixin<PatientImageCluster>;

  declare static associations: {
    clusters: Association<Patient, PatientImageCluster>;
  };
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
        const possibleSlug = patient.slug || patient.name;
        const base = toSlugIfCyr(possibleSlug);
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
