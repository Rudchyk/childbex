import { DataTypes, ForeignKey, Model, Optional } from 'sequelize';
import { sequelize } from '@/db';
import { PatientModelAttributes } from '@/types';
import { UserModel } from './User.model';

export * from '@/types/lib/Patient.types';

type PatientModelCreationAttributes = Optional<PatientModelAttributes, 'id'>;

export class PatientModel
  extends Model<PatientModelAttributes, PatientModelCreationAttributes>
  implements PatientModelAttributes
{
  declare id: string;
  declare name: string;
  declare slug: string;
  declare notes?: string | null;
  declare creatorId: ForeignKey<UserModel['id']>;
}

PatientModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    creatorId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: UserModel,
        key: 'id',
      },
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
  foreignKey: 'creatorId',
  as: 'creator',
});

PatientModel.belongsTo(UserModel, {
  foreignKey: 'creatorId',
  as: 'creator',
});
