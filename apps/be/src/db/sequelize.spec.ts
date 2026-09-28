/**
 * Startup database setup: connects and verifies the migration state, never
 * changes the schema. The database is replaced by spies (no connection).
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type * as SequelizeModule from './sequelize';
import { migrations } from './migrations';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  fatal: jest.fn(),
};
jest.mock('../services/logger.service', () => ({ logger: mockLogger }));

let db: typeof SequelizeModule;
let sync: jest.SpyInstance;
let authenticate: jest.SpyInstance;
let metaTableExists: boolean;
let applied: string[];

beforeAll(() => {
  // The old default: must not enable schema alteration any more.
  process.env.DB_SYNC = 'true';
  db = require('./sequelize');
});

afterAll(() => {
  delete process.env.DB_SYNC;
});

beforeEach(() => {
  jest.clearAllMocks();
  metaTableExists = true;
  applied = migrations.map(({ name }) => name);
  sync = jest.spyOn(db.sequelize, 'sync').mockResolvedValue(db.sequelize);
  authenticate = jest
    .spyOn(db.sequelize, 'authenticate')
    .mockResolvedValue(undefined);
  jest.spyOn(db.sequelize, 'query').mockImplementation((async (sql: string) =>
    sql.includes('to_regclass')
      ? [{ exists: metaTableExists }]
      : applied.map((name) => ({ name }))) as never);
});

describe('dbSetup', () => {
  it('connects and accepts a fully migrated database without changing the schema', async () => {
    await expect(db.dbSetup()).resolves.toBeUndefined();

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(sync).not.toHaveBeenCalled();
  });

  it('ignores DB_SYNC=true (with a warning) instead of altering the schema', async () => {
    await db.dbSetup();

    expect(sync).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('DB_SYNC is no longer supported')
    );
  });

  it('fails when the database is unavailable', async () => {
    authenticate.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(db.dbSetup()).rejects.toThrow('ECONNREFUSED');
    expect(sync).not.toHaveBeenCalled();
  });

  it('fails when migrations_meta is missing', async () => {
    metaTableExists = false;

    await expect(db.dbSetup()).rejects.toThrow(/"migrations_meta" table is missing/);
    expect(sync).not.toHaveBeenCalled();
  });

  it('fails when known migrations are pending', async () => {
    applied = [];

    await expect(db.dbSetup()).rejects.toThrow(
      `Pending database migrations: ${migrations[0].name}`
    );
    expect(sync).not.toHaveBeenCalled();
  });

  it('warns about migrations unknown to this version but starts', async () => {
    applied = [...applied, '209901010000-from-a-newer-version'];

    await expect(db.dbSetup()).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { unknown: ['209901010000-from-a-newer-version'] },
      expect.any(String)
    );
  });
});

describe('schema management', () => {
  const listSources = async (dir: string): Promise<string[]> =>
    (
      await Promise.all(
        (await readdir(dir, { withFileTypes: true })).map((entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return listSources(full);
          return /(?<!\.spec)\.ts$/.test(entry.name) ? [full] : [];
        })
      )
    ).flat();

  it('no application code calls sequelize/model sync()', async () => {
    const sources = await listSources(path.join(__dirname, '..'));
    const offenders: string[] = [];
    for (const file of sources) {
      if (/\.sync\s*\(/.test(await readFile(file, 'utf8'))) {
        offenders.push(path.relative(path.join(__dirname, '..'), file));
      }
    }

    expect(sources.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
