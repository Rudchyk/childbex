import { Sequelize } from 'sequelize';
import { logger } from '../services/logger.service';

const {
  DB_USER: username = '',
  DB_PASS: password = '',
  DB_NAME: database = '',
  DB_SYNC = 'true',
} = process.env;

logger.debug(
  {
    username,
    database,
  },
  'DB'
);

export const sequelize: Sequelize = new Sequelize(
  database,
  username,
  password,
  {
    dialect: 'postgres',
    logging: false,
  }
);

export const dbSetup = async () => {
  try {
    await sequelize.authenticate();

    if (DB_SYNC === 'true') {
      await sequelize.sync({ alter: true });
      logger.info('[DB] All models were synchronized successfully.');
    }

    logger.info('[DB] Connection OK');
  } catch (e) {
    logger.error(e, '[DB] Startup failed');
  }
};
