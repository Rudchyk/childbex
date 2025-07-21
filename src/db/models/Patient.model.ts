import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../../db';
import { PatientModelAttributes } from '../../types';
import { UserModel } from './User.model';

export * from '../../types/lib/Patient.types';

type PatientModelCreationAttributes = Optional<PatientModelAttributes, 'id'>;

export class PatientModel
  extends Model<PatientModelAttributes, PatientModelCreationAttributes>
  implements PatientModelAttributes
{
  declare id: string;
  declare name: string;
  declare slug: string;
  declare notes?: string;
  declare creator_id: string;
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
