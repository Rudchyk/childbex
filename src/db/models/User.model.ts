import { DataTypes, Model, Optional } from 'sequelize';
import bcrypt from 'bcrypt';
import { sequelize } from '@/db';
import { UserModelAttributes, UserRoles, PublicUser } from '@/types';
import { omit } from 'lodash';

export * from '@/types/lib/User.types';

type UserModelCreationAttributes = Optional<UserModelAttributes, 'id' | 'role'>;

export class UserModel
  extends Model<UserModelAttributes, UserModelCreationAttributes>
  implements UserModelAttributes
{
  public id!: string;
  public email!: string;
  public password!: string;
  public name!: string;
  public role!: UserRoles;

  public async comparePassword(plainText: string): Promise<boolean> {
    return bcrypt.compare(plainText, this.dataValues.password);
  }

  public getPublic(): PublicUser {
    const result = this.toJSON();
    return omit(result, 'password');
  }
}

UserModel.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      validate: { isEmail: true },
    },
    password: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false },
    role: {
      type: DataTypes.ENUM(...Object.values(UserRoles)),
      allowNull: false,
      defaultValue: UserRoles.USER,
    },
  },
  {
    sequelize,
    tableName: 'users',
    paranoid: true,
    hooks: {
      beforeSave: async (user: UserModel) => {
        if (user.changed('password')) {
          user.dataValues.password = await bcrypt.hash(
            user.dataValues.password,
            10
          );
        }
      },
    },
  }
);
