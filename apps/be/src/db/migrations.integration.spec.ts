/**
 * Migrations against a real PostgreSQL database.
 *
 * Runs only when TEST_DATABASE_URL is set, e.g.
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/childbex_migrations_test
 * Every test drops and recreates the `public` schema of that database, so
 * its name must contain "test" (never point it at a real database).
 */
import { QueryTypes, type Sequelize } from 'sequelize';
import type * as MigratorModule from './migrator';
import type { Migration } from './migrations';

jest.mock('../services/logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  console.info(
    'Skipping PostgreSQL migration tests: TEST_DATABASE_URL is not set.'
  );
}

jest.setTimeout(60_000);

/** A reversible migration after the baseline (exercises `down`). */
const probeMigration: Migration = {
  name: '209912310000-test-probe',
  async up({ sequelize }) {
    await sequelize.transaction((transaction) =>
      sequelize.query('CREATE TABLE zz_probe (id integer PRIMARY KEY)', {
        transaction,
      })
    );
  },
  async down({ sequelize }) {
    await sequelize.transaction((transaction) =>
      sequelize.query('DROP TABLE zz_probe', { transaction })
    );
  },
};

describeWithDatabase('database migrations (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let migrations: Migration[];
  /** The application models, in the order their tables depend on each other. */
  let models: { sync(options?: { alter?: boolean }): Promise<unknown> }[];

  const tableExists = async (table: string) =>
    (
      await sequelize.query<{ exists: boolean }>(
        'SELECT to_regclass(:table) IS NOT NULL AS "exists"',
        { replacements: { table }, plain: true, type: QueryTypes.SELECT }
      )
    )?.exists;

  /** The pre-migrations way: the schema created from the models. */
  const syncModels = async (options?: { alter?: boolean }) => {
    for (const model of models) await model.sync(options);
  };

  const resetDatabase = () =>
    sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  beforeAll(() => {
    const url = new URL(databaseUrl as string);
    const database = url.pathname.slice(1);
    if (!/test/i.test(database)) {
      throw new Error(
        `TEST_DATABASE_URL must name a test database (got "${database}").`
      );
    }
    if (url.port && url.port !== '5432') {
      throw new Error('TEST_DATABASE_URL must use port 5432 (DB_* has no port).');
    }
    // The application connection (and its models) point at the test database.
    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    // patients.service first: it and the models import each other.
    require('../services/patients.service');
    ({ sequelize } = require('./sequelize'));
    migrator = require('./migrator');
    ({ migrations } = require('./migrations'));
    models = [
      require('./models/Patient.model').Patient,
      require('./models/PatientImagesCluster.model').PatientImagesCluster,
      require('./models/PatientImage.model').PatientImage,
      require('./models/PatientImageReviewVote.model').PatientImageReviewVote,
    ];
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await sequelize.close();
  });

  it('creates a migration runner that knows all migrations', async () => {
    const listed = await migrator.createMigrator(sequelize).migrations({
      sequelize,
      queryInterface: sequelize.getQueryInterface(),
    });

    expect(listed.map(({ name }) => name)).toEqual(
      migrations.map(({ name }) => name)
    );
  });

  it('reports a new database as not migrated, without creating anything', async () => {
    const status = await migrator.getMigrationStatus(sequelize);

    expect(status).toEqual({
      initialized: false,
      executed: [],
      pending: migrations.map(({ name }) => name),
      unknown: [],
    });
    expect(await tableExists(migrator.migrationsTableName)).toBe(false);
  });

  it('applies all migrations to a new database', async () => {
    await expect(
      migrator.assertSchemaUpToDate(sequelize)
    ).rejects.toBeInstanceOf(migrator.SchemaNotReadyError);

    const applied = await migrator.migrateUp(sequelize);

    expect(applied.map(({ name }) => name)).toEqual(
      migrations.map(({ name }) => name)
    );
    const status = await migrator.getMigrationStatus(sequelize);
    expect(status.pending).toEqual([]);
    await expect(migrator.assertSchemaUpToDate(sequelize)).resolves.toBeTruthy();
    expect(await migrator.checkBaseline(sequelize)).toEqual({
      errors: [],
      warnings: [],
    });
    // Idempotent: nothing left to apply.
    expect(await migrator.migrateUp(sequelize)).toEqual([]);
  });

  it('creates exactly the schema the models define', async () => {
    await migrator.migrateUp(sequelize);
    const migrated = await migrator.readActualSchema(sequelize);
    delete migrated.columns[migrator.migrationsTableName];
    migrated.uniqueIndexes = migrated.uniqueIndexes.filter(
      ({ table }) => table !== migrator.migrationsTableName
    );

    await resetDatabase();
    await syncModels();
    const synced = await migrator.readActualSchema(sequelize);

    const normalize = (schema: MigratorModule.ActualSchema) => ({
      ...schema,
      uniqueIndexes: [...schema.uniqueIndexes].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      foreignKeys: [...schema.foreignKeys].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    });
    expect(normalize(migrated)).toEqual(normalize(synced));
  });

  it('rolls back only the latest migration', async () => {
    const withProbe = [...migrations, probeMigration];
    await migrator.migrateUp(sequelize, withProbe);
    expect(await tableExists('zz_probe')).toBe(true);

    const reverted = await migrator.migrateDown(sequelize, withProbe);

    expect(reverted.map(({ name }) => name)).toEqual([probeMigration.name]);
    expect(await tableExists('zz_probe')).toBe(false);
    expect(await tableExists('patients')).toBe(true);
    const status = await migrator.getMigrationStatus(sequelize, withProbe);
    expect(status.executed).toEqual(migrations.map(({ name }) => name));
    expect(status.pending).toEqual([probeMigration.name]);
    await expect(
      migrator.assertSchemaUpToDate(sequelize, withProbe)
    ).rejects.toThrow(`Pending database migrations: ${probeMigration.name}`);
  });

  it('refuses to revert the baseline and keeps schema, data and its record', async () => {
    await migrator.migrateUp(sequelize);
    await sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
       VALUES ('11111111-1111-4111-8111-111111111111', 'Synthetic', 'synthetic', 'u', 'U', now(), now())`
    );

    await expect(migrator.migrateDown(sequelize)).rejects.toThrow(
      'cannot be reverted'
    );

    expect(await tableExists('patients')).toBe(true);
    const [count] = await sequelize.query<{ count: string }>(
      'SELECT count(*) AS count FROM patients',
      { type: QueryTypes.SELECT }
    );
    expect(Number(count.count)).toBe(1);
    expect((await migrator.getMigrationStatus(sequelize)).executed).toEqual(
      migrations.map(({ name }) => name)
    );
  });

  describe('existing database created by model sync (before migrations)', () => {
    beforeEach(async () => {
      await syncModels();
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ('11111111-1111-4111-8111-111111111111', 'Synthetic', 'synthetic', 'u', 'U', now(), now())`
      );
    });

    it('is not started, and "up" refuses to recreate the schema', async () => {
      await expect(
        migrator.assertSchemaUpToDate(sequelize)
      ).rejects.toThrow(/"migrations_meta" table is missing/);
      await expect(migrator.migrateUp(sequelize)).rejects.toThrow(
        /baseline/
      );
      expect(await tableExists(migrator.migrationsTableName)).toBe(false);
    });

    it('passes the baseline check, and applying it records only the baseline', async () => {
      expect(await migrator.checkBaseline(sequelize)).toEqual({
        errors: [],
        warnings: [],
      });

      await migrator.applyBaseline(sequelize);

      const status = await migrator.getMigrationStatus(sequelize);
      expect(status.executed).toEqual(['202609280000-baseline-schema']);
      expect(status.pending).toEqual(
        migrations.slice(1).map(({ name }) => name)
      );
      const [count] = await sequelize.query<{ count: string }>(
        'SELECT count(*) AS count FROM patients',
        { type: QueryTypes.SELECT }
      );
      expect(Number(count.count)).toBe(1);
      await expect(migrator.applyBaseline(sequelize)).rejects.toThrow(
        /already recorded/
      );
    });

    it('accepts a schema altered repeatedly by sync({ alter: true }), with warnings only', async () => {
      // Every old startup ran this.
      for (let i = 0; i < 3; i++) await syncModels({ alter: true });

      const { errors, warnings } = await migrator.checkBaseline(sequelize);

      expect(errors).toEqual([]);
      // Each alter run adds another copy of the unique constraint on source.
      expect(warnings).toEqual([
        expect.stringMatching(
          /^4 duplicate unique indexes on patients_images\(source\): /
        ),
      ]);
    });

    it('refuses the baseline for a schema that does not match, recording nothing', async () => {
      await sequelize.query('ALTER TABLE patients DROP COLUMN "creatorName"');

      const { errors } = await migrator.checkBaseline(sequelize);
      expect(errors).toEqual(['missing column patients.creatorName']);

      await expect(migrator.applyBaseline(sequelize)).rejects.toThrow(
        'missing column patients.creatorName'
      );
      expect(await tableExists(migrator.migrationsTableName)).toBe(false);
    });
  });
});
