require('dotenv/config');

const {
  DB_USER: username = '',
  DB_PASS: password = '',
  DB_NAME: database = '',
} = process.env;

console.table({
  username,
  database,
});

module.exports = {
  development: {
    username: username,
    password: password,
    database: database,
    dialect: 'postgres',
  },
  production: {
    username: username,
    password: password,
    database: database,
    dialect: 'postgres',
  },
};
