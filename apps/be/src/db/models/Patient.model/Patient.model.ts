import { Model, Op, Association, HasManyGetAssociationsMixin } from 'sequelize';
import { sequelize } from '../../sequelize';
import { toSlugIfCyr } from '@libs/helpers';
import { PatientImagesCluster } from '../PatientImagesCluster.model';
import { removePath } from '../../../utils';
import path from 'path';
import { uploadRoot } from '../../../services/patients.service';
import { getPatientTable } from './Patient.table';
import {
  PatientCreationAttributes as PatientBaseCreationAttributes,
  Patient as IPatient,
} from '@libs/schemas';

export type PatientCreationAttributes = Omit<
  PatientBaseCreationAttributes,
  'notes' | 'slug'
> &
  Partial<Pick<PatientBaseCreationAttributes, 'notes' | 'slug'>>;

const { columns, indexes, options } = getPatientTable();

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

  declare getClusters: HasManyGetAssociationsMixin<PatientImagesCluster>;

  declare static associations: {
    clusters: Association<Patient, PatientImagesCluster>;
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

Patient.init(columns, {
  sequelize,
  ...options,
  indexes,
  hooks: {
    beforeValidate: async (inst) => {
      if (inst.isNewRecord || inst.changed('slug')) {
        await inst.ensureUniqueSlug();
      }
    },
    async afterDestroy(instance, options) {
      if (options.force) {
        await removePath(path.join(uploadRoot, instance.id));
      }
    },
  },
});
