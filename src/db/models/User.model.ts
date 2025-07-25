import {
  DataTypes,
  InferAttributes,
  InferCreationAttributes,
  Model,
} from 'sequelize';
import bcrypt from 'bcrypt';
import { sequelize } from '@/db';
import { User as UserAttributes, UserRoles, PublicUser } from '@/types';
import { omit } from 'lodash';
import { timestampFields } from '../helpers/timestamps';

export class User
  extends Model<
    InferAttributes<User>,
    InferCreationAttributes<
      User,
      {
        omit: 'id' | 'createdAt' | 'updatedAt' | 'deletedAt';
      }
    >
  >
  implements UserAttributes
{
  declare id: UserAttributes['id'];
  declare email: UserAttributes['email'];
  declare password: UserAttributes['password'];
  declare name: UserAttributes['name'];
  declare role: UserAttributes['role'];

  // Sequelize‑generated:
  declare readonly createdAt: UserAttributes['createdAt'];
  declare readonly updatedAt: UserAttributes['updatedAt'];
  declare readonly deletedAt: UserAttributes['deletedAt'];

  async comparePassword(plainText: string): Promise<boolean> {
    return bcrypt.compare(plainText, this.password);
  }

  public getPublic(): PublicUser {
    const user = this.toJSON();
    return omit(user, 'password');
  }
}

User.init(
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
    ...timestampFields,
  },
  {
    sequelize,
    tableName: 'users',
    timestamps: true,
    paranoid: true,
    indexes: [{ unique: true, fields: ['email'] }],
    hooks: {
      async beforeSave(user: User) {
        if (user.changed('password')) {
          user.password = await bcrypt.hash(user.password, 10);
        }
      },
    },
  }
);
