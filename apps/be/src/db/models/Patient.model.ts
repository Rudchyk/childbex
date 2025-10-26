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

  public async ensureUniqueSlug() {
    const possibleSlug = this.slug || this.name;
    const base = toSlugIfCyr(possibleSlug);
    const rows = await Patient.findAll({
      paranoid: false,
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
        this.slug = newSlug;
      }
    } else {
      if (!this.slug) {
        this.slug = base;
      }
    }
  }
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
      allowNull: false,
      validate: { is: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
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
    indexes: [
      {
        name: 'uniq_patient_slug_active',
        unique: true,
        fields: ['slug'],
        where: { deletedAt: null },
      },
    ],
    hooks: {
      beforeValidate: async (inst) => {
        if (inst.isNewRecord || inst.changed('slug')) {
          await inst.ensureUniqueSlug();
        }
      },
    },
  }
);
