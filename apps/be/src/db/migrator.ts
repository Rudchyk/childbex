import { QueryTypes, type Sequelize } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';
import { migrations as registeredMigrations } from './migrations';
import type { Migration, MigrationContext } from './migrations';
import {
  baselineMigration,
  baselineSchema,
  type ExpectedSchema,
} from './migrations/202609280000-baseline-schema';

/**
 * Dedicated table for applied migration names (snake_case like the domain
 * tables, and not tied to one tool). Never used for application data.
 */
export const migrationsTableName = 'migrations_meta';

/** Tells the operator what to do; safe to log (no data, no credentials). */
export class SchemaNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaNotReadyError';
  }
}

export class IrreversibleMigrationError extends Error {
  constructor(name: string) {
    super(`Migration "${name}" cannot be reverted (it would lose data).`);
    this.name = 'IrreversibleMigrationError';
  }
}

export const createMigrator = (
  sequelize: Sequelize,
  migrations: Migration[] = registeredMigrations
) =>
  new Umzug<MigrationContext>({
    migrations: migrations.map((migration) => ({
      name: migration.name,
      up: ({ context }) => migration.up(context),
      // Umzug treats a missing `down` as "nothing to revert" and forgets the
      // migration; an irreversible migration must fail instead.
      down: ({ context }) => {
        if (!migration.down) {
          throw new IrreversibleMigrationError(migration.name);
        }
        return migration.down(context);
      },
    })),
    context: { sequelize, queryInterface: sequelize.getQueryInterface() },
    storage: new SequelizeStorage({
      sequelize,
      tableName: migrationsTableName,
      modelName: 'MigrationsMeta',
    }),
    logger: undefined,
  });

const tableExists = async (sequelize: Sequelize, table: string) => {
  const [row] = await sequelize.query<{ exists: boolean }>(
    'SELECT to_regclass(:table) IS NOT NULL AS "exists"',
    { replacements: { table }, type: QueryTypes.SELECT }
  );
  return !!row?.exists;
};

/**
 * Applied migration names, or `null` when the metadata table does not
 * exist. Read-only: unlike Umzug's storage it never creates the table.
 */
export const readExecutedMigrations = async (
  sequelize: Sequelize
): Promise<string[] | null> => {
  if (!(await tableExists(sequelize, migrationsTableName))) return null;
  const rows = await sequelize.query<{ name: string }>(
    `SELECT name FROM "${migrationsTableName}" ORDER BY name`,
    { type: QueryTypes.SELECT }
  );
  return rows.map(({ name }) => name);
};

export interface MigrationStatus {
  /** `false`: the metadata table does not exist (not migrated/baselined). */
  initialized: boolean;
  executed: string[];
  pending: string[];
  /** Applied in the database but unknown to this version of the code. */
  unknown: string[];
}

export const getMigrationStatus = async (
  sequelize: Sequelize,
  migrations: Migration[] = registeredMigrations
): Promise<MigrationStatus> => {
  const executed = await readExecutedMigrations(sequelize);
  const applied = new Set(executed ?? []);
  const known = new Set(migrations.map(({ name }) => name));
  return {
    initialized: executed !== null,
    executed: executed ?? [],
    pending: migrations
      .map(({ name }) => name)
      .filter((name) => !applied.has(name)),
    unknown: (executed ?? []).filter((name) => !known.has(name)),
  };
};

const hasExistingApplicationSchema = (sequelize: Sequelize) =>
  tableExists(sequelize, Object.keys(baselineSchema.tables)[0]);

/**
 * Startup check (read-only): the schema must be fully migrated. The
 * application never changes the schema itself.
 */
export const assertSchemaUpToDate = async (
  sequelize: Sequelize,
  migrations: Migration[] = registeredMigrations
): Promise<MigrationStatus> => {
  const status = await getMigrationStatus(sequelize, migrations);
  if (!status.initialized) {
    throw new SchemaNotReadyError(
      `The "${migrationsTableName}" table is missing. New database: run the ` +
        'migrations. Existing database: check and apply the migration ' +
        'baseline first. See apps/be/src/db/README.md.'
    );
  }
  if (status.pending.length) {
    throw new SchemaNotReadyError(
      `Pending database migrations: ${status.pending.join(', ')}. ` +
        'Run the migrations before starting the backend.'
    );
  }
  return status;
};

/**
 * Applies all pending migrations. Refuses to run the baseline over an
 * existing, not yet baselined schema (that must be checked, not recreated).
 */
/**
 * For maintenance commands: the migrations up to and including `name` (what
 * the command needs) must be applied; later ones may still be pending (e.g.
 * a constraint that needs the command to run first).
 */
export const assertMigratedThrough = async (
  sequelize: Sequelize,
  name: string,
  migrations: Migration[] = registeredMigrations
) => {
  const index = migrations.findIndex((migration) => migration.name === name);
  if (index < 0) throw new Error(`Unknown migration "${name}".`);
  const status = await getMigrationStatus(sequelize, migrations);
  const applied = new Set(status.executed);
  const missing = migrations
    .slice(0, index + 1)
    .map((migration) => migration.name)
    .filter((migrationName) => !applied.has(migrationName));
  if (!status.initialized || missing.length) {
    throw new SchemaNotReadyError(
      `Pending database migrations: ${missing.join(', ')} (required by this ` +
        `command). Run \`node migrate.js up --to ${name}\` first.`
    );
  }
};

/**
 * For maintenance commands made obsolete by a migration: refuses once
 * `name` is applied (the command works on the schema before it).
 */
export const assertNotMigrated = async (
  sequelize: Sequelize,
  name: string,
  reason: string,
  migrations: Migration[] = registeredMigrations
) => {
  if (!migrations.some((migration) => migration.name === name)) {
    throw new Error(`Unknown migration "${name}".`);
  }
  const executed = await readExecutedMigrations(sequelize);
  if (executed?.includes(name)) {
    throw new SchemaNotReadyError(
      `This command is obsolete since migration ${name}: ${reason}`
    );
  }
};

export const migrateUp = async (
  sequelize: Sequelize,
  migrations: Migration[] = registeredMigrations,
  { to }: { to?: string } = {}
) => {
  if (to && !migrations.some(({ name }) => name === to)) {
    throw new Error(`Unknown migration "${to}".`);
  }
  const executed = await readExecutedMigrations(sequelize);
  if (!executed?.length && (await hasExistingApplicationSchema(sequelize))) {
    throw new SchemaNotReadyError(
      'The database already contains the application schema but no applied ' +
        'migrations. Check and apply the migration baseline instead ' +
        '(see apps/be/src/db/README.md).'
    );
  }
  // Already there: nothing to apply up to it.
  if (to && executed?.includes(to)) return [];
  return createMigrator(sequelize, migrations).up(to ? { to } : {});
};

/** Reverts only the latest applied migration. */
export const migrateDown = (
  sequelize: Sequelize,
  migrations: Migration[] = registeredMigrations
) => createMigrator(sequelize, migrations).down({ step: 1 });

// --- Baseline for databases created before migrations existed -------------

export interface ActualSchema {
  columns: Record<string, Record<string, { type: string; nullable: boolean }>>;
  enums: Record<string, string[]>;
  uniqueIndexes: {
    table: string;
    name: string;
    columns: string[];
    where: string | null;
    primary: boolean;
  }[];
  foreignKeys: {
    table: string;
    name: string;
    columns: string[];
    references: string;
    onDelete: string;
  }[];
}

/** Reads the parts of the live schema the baseline check compares. */
export const readActualSchema = async (
  sequelize: Sequelize
): Promise<ActualSchema> => {
  const select = <T extends object>(sql: string) =>
    sequelize.query<T>(sql, { type: QueryTypes.SELECT });

  const columnRows = await select<{
    table: string;
    column: string;
    type: string;
    nullable: string;
  }>(`
    SELECT table_name AS "table", column_name AS "column",
           udt_name AS "type", is_nullable AS "nullable"
    FROM information_schema.columns
    WHERE table_schema = current_schema()`);
  const columns: ActualSchema['columns'] = {};
  for (const row of columnRows) {
    columns[row.table] ??= {};
    columns[row.table][row.column] = {
      type: row.type,
      nullable: row.nullable === 'YES',
    };
  }

  const enumRows = await select<{ name: string; value: string }>(`
    SELECT t.typname AS "name", e.enumlabel AS "value"
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema()
    ORDER BY t.typname, e.enumsortorder`);
  const enums: ActualSchema['enums'] = {};
  for (const row of enumRows) {
    (enums[row.name] ??= []).push(row.value);
  }

  const uniqueIndexes = await select<ActualSchema['uniqueIndexes'][number]>(`
    SELECT tbl.relname AS "table", idx.relname AS "name",
           ARRAY(
             SELECT a.attname::text
             FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a
               ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
             ORDER BY k.ord
           ) AS "columns",
           pg_get_expr(ix.indpred, ix.indrelid) AS "where",
           ix.indisprimary AS "primary"
    FROM pg_index ix
    JOIN pg_class idx ON idx.oid = ix.indexrelid
    JOIN pg_class tbl ON tbl.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE ix.indisunique AND n.nspname = current_schema()`);

  const foreignKeys = await select<ActualSchema['foreignKeys'][number]>(`
    SELECT tbl.relname AS "table", c.conname AS "name",
           ARRAY(
             SELECT a.attname::text
             FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
             JOIN pg_attribute a
               ON a.attrelid = c.conrelid AND a.attnum = k.attnum
             ORDER BY k.ord
           ) AS "columns",
           ref.relname AS "references",
           CASE c.confdeltype
             WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT'
             ELSE 'NO ACTION'
           END AS "onDelete"
    FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE c.contype = 'f' AND n.nspname = current_schema()`);

  return { columns, enums, uniqueIndexes, foreignKeys };
};

export interface SchemaComparison {
  /** Differences the application would break on: the baseline is refused. */
  errors: string[];
  /** Differences to review (e.g. left by `sync({ alter: true })`). */
  warnings: string[];
}

const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((column, i) => column === b[i]);

/** Pure comparison of the expected baseline schema with the live one. */
export const compareSchema = (
  expected: ExpectedSchema,
  actual: ActualSchema
): SchemaComparison => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [table, expectedColumns] of Object.entries(expected.tables)) {
    const actualColumns = actual.columns[table];
    if (!actualColumns) {
      errors.push(`missing table ${table}`);
      continue;
    }
    for (const [column, { type, nullable }] of Object.entries(
      expectedColumns
    )) {
      const found = actualColumns[column];
      if (!found) {
        errors.push(`missing column ${table}.${column}`);
      } else if (found.type !== type) {
        errors.push(
          `column ${table}.${column} has type ${found.type}, expected ${type}`
        );
      } else if (found.nullable !== nullable) {
        errors.push(
          `column ${table}.${column} is ${found.nullable ? '' : 'NOT '}NULL, ` +
            `expected ${nullable ? '' : 'NOT '}NULL`
        );
      }
    }
    for (const column of Object.keys(actualColumns)) {
      if (!expectedColumns[column]) {
        warnings.push(`unexpected column ${table}.${column}`);
      }
    }
  }

  for (const [name, values] of Object.entries(expected.enums)) {
    const found = actual.enums[name];
    if (!found) {
      errors.push(`missing enum type ${name}`);
      continue;
    }
    const missing = values.filter((value) => !found.includes(value));
    if (missing.length) {
      errors.push(`enum ${name} is missing values: ${missing.join(', ')}`);
    }
    const extra = found.filter((value) => !values.includes(value));
    if (extra.length) {
      warnings.push(`enum ${name} has extra values: ${extra.join(', ')}`);
    }
  }

  for (const index of expected.uniqueIndexes) {
    const matches = actual.uniqueIndexes.filter(
      (found) =>
        found.table === index.table &&
        sameColumns(found.columns, index.columns) &&
        (found.where ?? undefined) === index.where &&
        (!index.primary || found.primary)
    );
    const description = `${index.table}(${index.columns.join(', ')})${
      index.where ? ` WHERE ${index.where}` : ''
    }`;
    if (!matches.length) {
      errors.push(
        `missing ${index.primary ? 'primary key' : 'unique index'} ${description}`
      );
    } else if (matches.length > 1) {
      warnings.push(
        `${matches.length} duplicate unique indexes on ${description}: ` +
          matches.map(({ name }) => name).join(', ')
      );
    }
  }

  for (const key of expected.foreignKeys) {
    const matches = actual.foreignKeys.filter(
      (found) =>
        found.table === key.table &&
        sameColumns(found.columns, key.columns) &&
        found.references === key.references
    );
    const description = `${key.table}(${key.columns.join(', ')}) -> ${
      key.references
    }`;
    if (!matches.length) {
      errors.push(`missing foreign key ${description}`);
    } else if (!matches.some(({ onDelete }) => onDelete === key.onDelete)) {
      errors.push(
        `foreign key ${description} is ON DELETE ${matches[0].onDelete}, ` +
          `expected ${key.onDelete}`
      );
    } else if (matches.length > 1) {
      warnings.push(
        `${matches.length} duplicate foreign keys ${description}: ` +
          matches.map(({ name }) => name).join(', ')
      );
    }
  }

  return { errors, warnings };
};

/** Read-only: compares the live schema with the baseline. */
export const checkBaseline = async (
  sequelize: Sequelize
): Promise<SchemaComparison> =>
  compareSchema(baselineSchema, await readActualSchema(sequelize));

/**
 * Marks the baseline as applied on an existing database without changing
 * its schema. Refused when the check finds errors or when migrations were
 * already recorded.
 */
export const applyBaseline = async (
  sequelize: Sequelize
): Promise<SchemaComparison> => {
  const executed = await readExecutedMigrations(sequelize);
  if (executed?.length) {
    throw new SchemaNotReadyError(
      `Migrations are already recorded (${executed.join(', ')}); ` +
        'the baseline applies only to a database that was never migrated.'
    );
  }
  const comparison = await checkBaseline(sequelize);
  if (comparison.errors.length) {
    throw new SchemaNotReadyError(
      'The live schema does not match the baseline; nothing was recorded:\n' +
        comparison.errors.map((error) => `  - ${error}`).join('\n')
    );
  }
  await new SequelizeStorage({
    sequelize,
    tableName: migrationsTableName,
    modelName: 'MigrationsMeta',
  }).logMigration({ name: baselineMigration.name });
  return comparison;
};
