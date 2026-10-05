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
import type * as PatientImageModel from './models/PatientImage.model';

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
  let baselineMigration: Migration;
  let PatientImage: typeof PatientImageModel.PatientImage;
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
    ({ baselineMigration } = require('./migrations/202609280000-baseline-schema'));
    ({ PatientImage } = require('./models/PatientImage.model'));
    models = [
      require('./models/Patient.model').Patient,
      require('./models/Study.model').Study,
      require('./models/Series.model').Series,
      PatientImage,
      require('./models/PatientImageReviewVote.model').PatientImageReviewVote,
      require('./models/PatientImageReviewVoteEvent.model')
        .PatientImageReviewVoteEvent,
      require('./models/PatientImageReviewResolution.model')
        .PatientImageReviewResolution,
      require('./models/PatientImageReviewCompletion.model')
        .PatientImageReviewCompletion,
      require('./models/ReviewFreeze.model').ReviewFreeze,
      require('./models/SeriesReviewCompletion.model').SeriesReviewCompletion,
      ...(() => {
        const snapshots = require('./models/DatasetSnapshot.model');
        return [
          snapshots.DatasetSnapshot,
          snapshots.DatasetSnapshotPatient,
          snapshots.DatasetSnapshotItem,
          snapshots.DatasetSnapshotExclusion,
        ];
      })(),
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
    // The baseline check is for databases created before migrations. After
    // all migrations the only differences it reports as errors are the
    // intentionally removed clusters (202610010000); new columns are warnings.
    const { errors } = await migrator.checkBaseline(sequelize);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toMatch(/patient_images_clusters|clusterId|details/);
    }
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

    // Sequelize cannot declare this composite FK: it exists in the
    // migration only (an item carries its patient's split).
    migrated.foreignKeys = migrated.foreignKeys.filter(
      ({ name }) => name !== 'dataset_snapshot_items_patient_split_fkey'
    );
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
    const baselineOnly = [baselineMigration];
    await migrator.migrateUp(sequelize, baselineOnly);
    await sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
       VALUES ('11111111-1111-4111-8111-111111111111', 'Synthetic', 'synthetic', 'u', 'U', now(), now())`
    );

    await expect(
      migrator.migrateDown(sequelize, baselineOnly)
    ).rejects.toThrow('cannot be reverted');

    expect(await tableExists('patients')).toBe(true);
    const [count] = await sequelize.query<{ count: string }>(
      'SELECT count(*) AS count FROM patients',
      { type: QueryTypes.SELECT }
    );
    expect(Number(count.count)).toBe(1);
    expect(
      (await migrator.getMigrationStatus(sequelize, baselineOnly)).executed
    ).toEqual([baselineMigration.name]);
  });

  describe('existing database (schema created before migrations)', () => {
    beforeEach(async () => {
      // Exactly the schema the old startup sync created, without any record
      // in migrations_meta (verified equal to it when the baseline was added).
      await baselineMigration.up({
        sequelize,
        queryInterface: sequelize.getQueryInterface(),
      });
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
      // Every old startup ran sync({ alter: true }), which added another copy
      // of the unique constraint on source each time. (The old models no
      // longer exist, so the effect is reproduced directly.)
      for (let i = 1; i <= 3; i++) {
        await sequelize.query(
          `ALTER TABLE patients_images ADD CONSTRAINT patients_images_source_key${i} UNIQUE (source)`
        );
      }

      const { errors, warnings } = await migrator.checkBaseline(sequelize);

      expect(errors).toEqual([]);
      expect(warnings).toContainEqual(
        expect.stringMatching(
          /^4 duplicate unique indexes on patients_images\(source\): /
        )
      );
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

  describe('patient image DICOM metadata migration', () => {
    const metadataMigration = '202609281200-patient-image-dicom-metadata';
    /** The migrations up to this one (later ones build on it). */
    const upToMetadata = () =>
      migrations.slice(
        0,
        migrations.findIndex(({ name }) => name === metadataMigration) + 1
      );
    const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
    const CLUSTER_ID = '22222222-2222-4222-8222-222222222222';
    const IMAGE_ID = '33333333-3333-4333-8333-333333333333';
    const STUDY_ID = '44444444-4444-4444-8444-444444444444';
    const SERIES_ID = '55555555-5555-4555-8555-555555555555';

    /** Column -> Postgres udt_name, as the migration adds them. */
    const expectedColumns: Record<string, string> = {
      studyInstanceUid: 'varchar',
      seriesInstanceUid: 'varchar',
      sopInstanceUid: 'varchar',
      sopClassUid: 'varchar',
      modality: 'varchar',
      imageType: '_text',
      seriesNumber: 'int4',
      instanceNumber: 'int4',
      frameOfReferenceUid: 'varchar',
      seriesDescription: 'text',
      convolutionKernel: 'text',
      imagePositionPatient: '_float8',
      imageOrientationPatient: '_float8',
      slicePosition: 'float8',
      rows: 'int4',
      columns: 'int4',
      pixelSpacing: '_float8',
      sliceThickness: 'float8',
      rescaleSlope: 'float8',
      rescaleIntercept: 'float8',
      photometricInterpretation: 'varchar',
      bitsStored: 'int2',
      pixelRepresentation: 'int2',
      numberOfFrames: 'int4',
      transferSyntaxUid: 'varchar',
      fileSha256: 'bpchar',
      fileSize: 'int8',
    };

    const insertPatientAndCluster = () =>
      sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ('${PATIENT_ID}', 'Synthetic', 'synthetic', 'u', 'U', now(), now());
         INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
         VALUES ('${CLUSTER_ID}', 'SYNTHETIC', 0, '${PATIENT_ID}', now(), now());`
      );

    it('adds nullable metadata columns and keeps existing rows unchanged', async () => {
      // An existing database with an image imported before this migration.
      await baselineMigration.up({
        sequelize,
        queryInterface: sequelize.getQueryInterface(),
      });
      await insertPatientAndCluster();
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", "createdAt", "updatedAt")
         VALUES ('${IMAGE_ID}', '/uploads/p/c/IM1', '${CLUSTER_ID}', now(), now())`
      );
      await migrator.applyBaseline(sequelize);

      const applied = await migrator.migrateUp(sequelize, upToMetadata());

      expect(applied.map(({ name }) => name)).toEqual([metadataMigration]);
      const { columns } = await migrator.readActualSchema(sequelize);
      for (const [column, type] of Object.entries(expectedColumns)) {
        expect([column, columns.patients_images[column]]).toEqual([
          column,
          { type, nullable: true },
        ]);
      }
      const [row] = await sequelize.query<Record<string, unknown>>(
        `SELECT * FROM patients_images WHERE id = '${IMAGE_ID}'`,
        { type: QueryTypes.SELECT }
      );
      expect(row.source).toBe('/uploads/p/c/IM1');
      for (const column of Object.keys(expectedColumns)) {
        expect([column, row[column]]).toEqual([column, null]);
      }
    });

    it('stores typed arrays, doubles and a bigint file size through the model', async () => {
      await migrator.migrateUp(sequelize);
      await sequelize.query(
        `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
         VALUES ('${PATIENT_ID}', 'Synthetic', 'synthetic', 'u', 'U', now(), now());
         INSERT INTO studies (id, "patientId", "studyInstanceUid", "createdAt", "updatedAt")
         VALUES ('${STUDY_ID}', '${PATIENT_ID}', '2.25.10', now(), now());
         INSERT INTO series (id, "studyId", "seriesInstanceUid", "createdAt", "updatedAt")
         VALUES ('${SERIES_ID}', '${STUDY_ID}', '2.25.11', now(), now());`
      );

      await PatientImage.create({
        seriesId: SERIES_ID,
        source: '/uploads/p/s/IM2',
        notes: undefined,
        sopInstanceUid: '2.25.1',
        imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
        imagePositionPatient: [-125.5, -130.25, 42.75],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        pixelSpacing: [0.703125, 0.703125],
        slicePosition: 42.75,
        rescaleSlope: 1,
        rescaleIntercept: -1024,
        bitsStored: 12,
        pixelRepresentation: 1,
        fileSha256: 'a'.repeat(64),
        fileSize: 3_000_000_000,
      });

      const stored = await PatientImage.findOne({
        where: { source: '/uploads/p/s/IM2' },
      });
      expect(stored?.toJSON()).toMatchObject({
        sopInstanceUid: '2.25.1',
        imageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
        imagePositionPatient: [-125.5, -130.25, 42.75],
        imageOrientationPatient: [1, 0, 0, 0, 1, 0],
        pixelSpacing: [0.703125, 0.703125],
        slicePosition: 42.75,
        rescaleSlope: 1,
        rescaleIntercept: -1024,
        bitsStored: 12,
        pixelRepresentation: 1,
        fileSha256: 'a'.repeat(64),
        // int8 is returned as a string by the pg driver.
        fileSize: '3000000000',
        studyInstanceUid: null,
      });
    });

    it.each([
      [
        'an IPP without 3 values',
        `"imagePositionPatient" = '{1,2}'`,
        'patients_images_ipp_length',
      ],
      [
        'an IOP without 6 values',
        `"imageOrientationPatient" = '{1,0,0}'`,
        'patients_images_iop_length',
      ],
      [
        'a pixel spacing without 2 values',
        `"pixelSpacing" = '{0.5}'`,
        'patients_images_pixel_spacing_length',
      ],
      [
        'an upper-case SHA-256',
        `"fileSha256" = '${'A'.repeat(64)}'`,
        'patients_images_file_sha256_hex',
      ],
      [
        'a short SHA-256',
        `"fileSha256" = 'abc'`,
        'patients_images_file_sha256_hex',
      ],
    ])('rejects %s', async (_, assignment, constraint) => {
      await migrator.migrateUp(sequelize, upToMetadata());
      await insertPatientAndCluster();
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", "createdAt", "updatedAt")
         VALUES ('${IMAGE_ID}', '/uploads/p/c/IM1', '${CLUSTER_ID}', now(), now())`
      );

      // check_violation; the message is localized by the server.
      await expect(
        sequelize.query(`UPDATE patients_images SET ${assignment}`)
      ).rejects.toMatchObject({ parent: { code: '23514', constraint } });
    });

    it('can be rolled back (and applied again)', async () => {
      await migrator.migrateUp(sequelize, upToMetadata());

      const reverted = await migrator.migrateDown(sequelize, upToMetadata());

      expect(reverted.map(({ name }) => name)).toEqual([metadataMigration]);
      const { columns } = await migrator.readActualSchema(sequelize);
      for (const column of Object.keys(expectedColumns)) {
        expect(columns.patients_images).not.toHaveProperty(column);
      }
      expect(await migrator.checkBaseline(sequelize)).toEqual({
        errors: [],
        warnings: [],
      });
      expect(
        (await migrator.migrateUp(sequelize, upToMetadata())).map(
          ({ name }) => name
        )
      ).toEqual([metadataMigration]);
    });
  });
});
