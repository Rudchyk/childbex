import { DataTypes } from 'sequelize';

// For models without soft deletes
export const basicTimestampFields = {
  createdAt: { type: DataTypes.DATE, allowNull: false },
  updatedAt: { type: DataTypes.DATE, allowNull: false },
};

// For models with soft deletes
export const timestampFields = {
  ...basicTimestampFields,
  deletedAt: { type: DataTypes.DATE, allowNull: true },
};
