import { Sequelize } from 'sequelize';
import pg from 'pg';

const {
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_HOST = 'localhost',
  DB_PORT = '5432',
} = process.env;

console.debug('NODE_ENV', process.env.NODE_ENV);

export const sequelize = new Sequelize(DB_NAME!, DB_USER!, DB_PASS, {
  host: DB_HOST,
  port: parseInt(DB_PORT!, 10),
  dialect: 'postgres',
  dialectModule: pg,
  logging: false,
});

export const syncDb = async () => {
  await sequelize.sync();
};
