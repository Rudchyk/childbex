const {
  getPatientTable,
} = require('../../apps/be/src/db/models/Patient.model/Patient.table');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const { columns, options, indexes } = getPatientTable();
    await queryInterface.createTable(options.tableName, columns);
    for (const idx of indexes) {
      await queryInterface.addIndex(options.tableName, idx);
    }
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.dropTable(options.tableName);
  },
};
