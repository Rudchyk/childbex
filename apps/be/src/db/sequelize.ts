import { Sequelize } from 'sequelize';
import { logger } from '../services/logger.service';
import { assertSchemaUpToDate } from './migrator';

const {
  DB_USER: username = '',
  DB_PASS: password = '',
  DB_NAME: database = '',
  DB_HOST: host = 'localhost',
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
    host,
    logging: false,
  }
);

/**
 * Connects and verifies that all migrations are applied. The schema is
 * managed only by migrations (see README.md); the application never changes
 * it. Throws when the database is unavailable or not migrated, so that the
 * backend does not start against a wrong schema.
 */
export const dbSetup = async () => {
  if (process.env.DB_SYNC !== undefined) {
    logger.warn(
      '[DB] DB_SYNC is no longer supported and is ignored; the schema is ' +
        'managed by migrations (npm run be:migrate).'
    );
  }

  await sequelize.authenticate();
  const { unknown } = await assertSchemaUpToDate(sequelize);
  if (unknown.length) {
    logger.warn(
      { unknown },
      '[DB] The database has migrations this version does not know ' +
        '(it was migrated by a newer version).'
    );
  }

  logger.info('[DB] Connection OK, schema up to date');
};
