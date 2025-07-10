import { DataTypes, Model, Optional, Transaction } from 'sequelize';
import { sequelize } from '@/db';
import { ExtendedPatient, PatientModelAttributes } from '@/types';
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
  declare notes: string;
  declare creator_id: string;

  static async findExtendedPatients(): Promise<ExtendedPatient[]> {
    return await sequelize.transaction(
      {
        isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE,
        type: Transaction.TYPES.EXCLUSIVE,
      },
      async () => {
        const result = await this.findAll({
          include: [
            {
              model: UserModel,
              as: 'creator',
            },
          ],
        });
        return result.map((r) => r.toJSON());
      }
    );
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
