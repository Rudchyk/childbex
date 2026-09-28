/** Migration registry, runner creation and the baseline schema comparison. */
import { Sequelize } from 'sequelize';
import { migrations } from './migrations';
import { baselineSchema } from './migrations/202609280000-baseline-schema';
import { compareSchema, createMigrator, type ActualSchema } from './migrator';

/** The live schema exactly as the baseline expects it. */
const matchingSchema = (): ActualSchema => ({
  columns: Object.fromEntries(
    Object.entries(baselineSchema.tables).map(([table, columns]) => [
      table,
      Object.fromEntries(
        Object.entries(columns).map(([column, { type, nullable }]) => [
          column,
          { type, nullable },
        ])
      ),
    ])
  ),
  enums: structuredClone(baselineSchema.enums),
  uniqueIndexes: baselineSchema.uniqueIndexes.map((index, i) => ({
    table: index.table,
    name: `index_${i}`,
    columns: [...index.columns],
    where: index.where ?? null,
    primary: !!index.primary,
  })),
  foreignKeys: baselineSchema.foreignKeys.map((key, i) => ({
    table: key.table,
    name: `fk_${i}`,
    columns: [...key.columns],
    references: key.references,
    onDelete: key.onDelete,
  })),
});

describe('migration registry', () => {
  it('has unique, ordered, timestamp-prefixed names', () => {
    const names = migrations.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    for (const name of names) {
      expect(name).toMatch(/^\d{12}-[a-z0-9-]+$/);
    }
  });

  it('starts with the non-reversible baseline', () => {
    expect(migrations[0].name).toBe('202609280000-baseline-schema');
    expect(migrations[0].down).toBeUndefined();
  });
});

describe('createMigrator', () => {
  it('creates a runner that knows every migration (no connection needed)', async () => {
    const sequelize = new Sequelize('postgres://user:pass@127.0.0.1:1/none', {
      logging: false,
    });

    const listed = await createMigrator(sequelize).migrations({
      sequelize,
      queryInterface: sequelize.getQueryInterface(),
    });

    expect(listed.map(({ name }) => name)).toEqual(
      migrations.map(({ name }) => name)
    );
    await sequelize.close();
  });
});

describe('compareSchema', () => {
  it('accepts a matching schema', () => {
    expect(compareSchema(baselineSchema, matchingSchema())).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('reports missing tables, columns, and type or nullability changes as errors', () => {
    const actual = matchingSchema();
    delete actual.columns.patient_image_review_votes;
    delete actual.columns.patients.slug;
    actual.columns.patients_images.source.type = 'text';
    actual.columns.patient_images_clusters.name.nullable = true;

    const { errors, warnings } = compareSchema(baselineSchema, actual);

    expect(errors).toEqual(
      expect.arrayContaining([
        'missing table patient_image_review_votes',
        'missing column patients.slug',
        'column patients_images.source has type text, expected varchar',
        'column patient_images_clusters.name is NULL, expected NOT NULL',
      ])
    );
    expect(warnings).toEqual([]);
  });

  it('reports extra columns as warnings only', () => {
    const actual = matchingSchema();
    actual.columns.patients.legacy = { type: 'text', nullable: true };

    expect(compareSchema(baselineSchema, actual)).toEqual({
      errors: [],
      warnings: ['unexpected column patients.legacy'],
    });
  });

  it('reports missing enum values as errors and extra ones as warnings', () => {
    const actual = matchingSchema();
    actual.enums.enum_patients_images_status = ['not_reviewed', 'normal', 'x'];
    delete actual.enums.enum_patient_image_review_votes_vote;

    const { errors, warnings } = compareSchema(baselineSchema, actual);

    expect(errors).toEqual([
      'missing enum type enum_patient_image_review_votes_vote',
      'enum enum_patients_images_status is missing values: abnormal, conflicted, admin_resolved, broken',
    ]);
    expect(warnings).toEqual([
      'enum enum_patients_images_status has extra values: x',
    ]);
  });

  it('requires unique indexes (with their predicate) and flags duplicates left by sync({ alter })', () => {
    const actual = matchingSchema();
    actual.uniqueIndexes = actual.uniqueIndexes.filter(
      ({ table, columns }) =>
        !(table === 'patient_image_review_votes' && columns.length === 2)
    );
    const slug = actual.uniqueIndexes.find(({ columns }) => columns[0] === 'slug');
    if (slug) slug.where = null;
    const source = actual.uniqueIndexes.find(({ columns }) => columns[0] === 'source');
    if (source) {
      actual.uniqueIndexes.push(
        { ...source, name: 'patients_images_source_key1' },
        { ...source, name: 'patients_images_source_key2' }
      );
    }

    const { errors, warnings } = compareSchema(baselineSchema, actual);

    expect(errors).toEqual([
      'missing unique index patients(slug) WHERE ("deletedAt" IS NULL)',
      'missing unique index patient_image_review_votes(patientImageId, reviewerId)',
    ]);
    expect(warnings).toEqual([
      expect.stringMatching(
        /^3 duplicate unique indexes on patients_images\(source\): .*source_key1, patients_images_source_key2$/
      ),
    ]);
  });

  it('requires foreign keys with ON DELETE CASCADE', () => {
    const actual = matchingSchema();
    actual.foreignKeys[0].onDelete = 'NO ACTION';
    actual.foreignKeys.splice(1, 1);

    expect(compareSchema(baselineSchema, actual).errors).toEqual([
      'foreign key patient_images_clusters(patientId) -> patients is ON DELETE NO ACTION, expected CASCADE',
      'missing foreign key patients_images(clusterId) -> patient_images_clusters',
    ]);
  });
});
