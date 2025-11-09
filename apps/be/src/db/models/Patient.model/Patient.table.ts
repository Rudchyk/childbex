import {
  DataTypes,
  IndexesOptions,
  InitOptions,
  Model,
  ModelAttributes,
} from 'sequelize';
import {
  timestampFields,
  deletedAtPropertyField,
} from '../../helpers/timestamps';
import { Patient } from '@libs/schemas';

export const getPatientTable = (): {
  columns: ModelAttributes<Model, Patient>;
  indexes: IndexesOptions[];
  options: Partial<InitOptions<Model>>;
} => ({
  columns: {
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
  indexes: [
    {
      name: 'uniq_patient_slug_active',
      unique: true,
      fields: ['slug'],
      where: { deletedAt: null },
    },
  ],
  options: {
    tableName: 'patients',
    paranoid: true,
    timestamps: true,
  },
});
