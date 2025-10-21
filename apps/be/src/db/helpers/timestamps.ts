import { DataTypes } from 'sequelize';

export const timestampFields = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
};

export const deletedAtPropertyField = {
  deletedAt: { type: DataTypes.DATE, allowNull: true },
};
