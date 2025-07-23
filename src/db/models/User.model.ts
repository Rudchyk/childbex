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
  declare id: string;
  declare email: string;
  declare password: string;
  declare name: string;
  declare role: UserRoles;

  async comparePassword(plainText: string): Promise<boolean> {
    return bcrypt.compare(plainText, this.password);
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
    indexes: [{ unique: true, fields: ['email'] }],
    hooks: {
      async beforeSave(user: UserModel) {
        if (user.changed('password')) {
          user.password = await bcrypt.hash(user.password, 10);
        }
      },
    },
  }
);
