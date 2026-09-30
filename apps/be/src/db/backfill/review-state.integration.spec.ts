/**
 * Review-state rollout against PostgreSQL: migrations 202609302000/-2010
 * on a database with legacy review data, `audit review-state`, `backfill
 * review-state` (dry-run, apply, operator decisions for ambiguous legacy
 * resolutions, idempotency) and migration 202609302020 refusing until every
 * image has a derived state.
 *
 * Runs only when TEST_DATABASE_URL is set, in its own database
 * "<name of TEST_DATABASE_URL>_review_backfill" (created when missing);
 * every test recreates its `public` schema. Synthetic data only.
 */
import { QueryTypes, Sequelize } from 'sequelize';
import { ReviewResolutionLabel } from '@libs/schemas';
import type * as MigratorModule from '../migrator';
import type * as BackfillModule from './review-state.backfill';
import type * as CliModule from './review-state.cli';

jest.mock('../../services/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
if (!databaseUrl) {
  console.info('Skipping PostgreSQL review-state backfill tests: TEST_DATABASE_URL is not set.');
}

jest.setTimeout(60_000);

const BEFORE_REVIEW = '202609301800-patient-image-sop-unique';
const REVIEW_SCHEMA = '202609302010-review-semantics-schema';
const REVIEW_REQUIRED = '202609302020-review-state-required';

const PATIENT = '11111111-1111-4111-8111-111111111111';
const CLUSTER = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;
const LEGACY_TIME = '2025-01-02T03:04:05.000Z';
/** Legacy free text / names that must never reach reports or output. */
const LEGACY_NAME = 'Legacy Admin Person';
const LEGACY_COMMENT = 'free text that may hold PHI';

/**
 * Legacy images (as the old hooks left them):
 *  1 no votes, status normal (old default)        -> NOT_REVIEWED
 *  2 3 normal + 1 abnormal, status normal (majority) -> CONFLICTED
 *  3 2 uncertain, status conflicted               -> UNCERTAIN
 *  4 2 abnormal, status abnormal                  -> ABNORMAL
 *  5 legacy resolution (all fields), 1 normal vote -> ambiguous
 *  6 legacy resolution (no resolver id), 1 abnormal -> ambiguous
 *  7 broken                                       -> NOT_REVIEWED, broken
 *  8 counters drifted (5 recorded, 1 real normal)  -> NORMAL
 */
const legacyImages: {
  n: number;
  status: string;
  votes: string[];
  broken?: boolean;
  isAbnormal?: boolean;
  votesCount?: number;
  resolution?: { id: string | null; name: string | null; comment: string | null; at: string | null };
}[] = [
  { n: 1, status: 'normal', votes: [] },
  { n: 2, status: 'normal', votes: ['normal', 'normal', 'normal', 'abnormal'] },
  { n: 3, status: 'conflicted', votes: ['uncertain', 'uncertain'] },
  { n: 4, status: 'abnormal', votes: ['abnormal', 'abnormal'], isAbnormal: true },
  {
    n: 5,
    status: 'admin_resolved',
    votes: ['normal'],
    resolution: { id: 'legacy-admin-sub', name: LEGACY_NAME, comment: LEGACY_COMMENT, at: LEGACY_TIME },
  },
  {
    n: 6,
    status: 'admin_resolved',
    votes: ['abnormal'],
    resolution: { id: null, name: LEGACY_NAME, comment: null, at: LEGACY_TIME },
  },
  { n: 7, status: 'broken', votes: [], broken: true },
  { n: 8, status: 'normal', votes: ['normal'], votesCount: 5 },
];

describeWithDatabase('review-state rollout (PostgreSQL)', () => {
  let sequelize: Sequelize;
  let migrator: typeof MigratorModule;
  let backfill: typeof BackfillModule;
  let cli: typeof CliModule;

  beforeAll(async () => {
    const url = new URL(databaseUrl as string);
    const database = `${url.pathname.slice(1)}_review_backfill`;
    if (!/test/i.test(database)) {
      throw new Error(`TEST_DATABASE_URL must name a test database (got "${database}").`);
    }
    if (url.port && url.port !== '5432') {
      throw new Error('TEST_DATABASE_URL must use port 5432 (DB_* has no port).');
    }
    const admin = new Sequelize(databaseUrl as string, { logging: false });
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', {
      bind: [database],
      type: QueryTypes.SELECT,
    });
    if (!exists.length) await admin.query(`CREATE DATABASE "${database}"`);
    await admin.close();

    process.env.DB_USER = decodeURIComponent(url.username);
    process.env.DB_PASS = decodeURIComponent(url.password);
    process.env.DB_HOST = url.hostname;
    process.env.DB_NAME = database;

    // patients.service first: it and the models import each other.
    require('../../services/patients.service');
    ({ sequelize } = require('../sequelize'));
    migrator = require('../migrator');
    backfill = require('./review-state.backfill');
    cli = require('./review-state.cli');
  });

  /** A database with legacy review data, migrated through the review schema. */
  beforeEach(async () => {
    await sequelize.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrator.migrateUp(sequelize, undefined, { to: BEFORE_REVIEW });
    await sequelize.query(
      `INSERT INTO patients (id, name, slug, "creatorId", "creatorName", "createdAt", "updatedAt")
       VALUES ($1, 'Synthetic', 'synthetic', 'u', 'U', now(), now())`,
      { bind: [PATIENT] }
    );
    await sequelize.query(
      `INSERT INTO patient_images_clusters (id, name, cluster, "patientId", "createdAt", "updatedAt")
       VALUES ($1, 'SYNTHETIC', 0, $2, now(), now())`,
      { bind: [CLUSTER, PATIENT] }
    );
    for (const image of legacyImages) {
      const count = (vote: string) => image.votes.filter((v) => v === vote).length;
      await sequelize.query(
        `INSERT INTO patients_images (id, source, "clusterId", "isBrocken", "isAbnormal", status,
           "votesCount", "normalVotes", "abnormalVotes", "uncertainVotes",
           "adminResolutionId", "adminResolutionName", "resolutionComment", "resolvedAt",
           "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           '2025-06-01T00:00:00Z', '2025-06-01T00:00:00Z')`,
        {
          bind: [
            id(image.n),
            `/uploads/p/c/IM${image.n}`,
            CLUSTER,
            !!image.broken,
            !!image.isAbnormal,
            image.status,
            image.votesCount ?? image.votes.length,
            count('normal'),
            count('abnormal'),
            count('uncertain'),
            image.resolution?.id ?? null,
            image.resolution?.name ?? null,
            image.resolution?.comment ?? null,
            image.resolution?.at ?? null,
          ],
        }
      );
      for (const [i, vote] of image.votes.entries()) {
        await sequelize.query(
          `INSERT INTO patient_image_review_votes (id, "patientImageId", "reviewerId", "reviewerName", vote, "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, 'Reviewer', $3, now(), now())`,
          { bind: [id(image.n), `sub-${i}`, vote] }
        );
      }
    }
    await migrator.migrateUp(sequelize, undefined, { to: REVIEW_SCHEMA });
  });

  afterAll(async () => {
    await sequelize?.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await sequelize?.close();
  });

  // --- Helpers -----------------------------------------------------------------

  const images = () =>
    sequelize.query<Record<string, unknown>>(
      `SELECT id, "reviewState", "reviewStateSource", status::text AS status, "isAbnormal",
              "votesCount", "normalVotes", "abnormalVotes", "uncertainVotes",
              "adminResolutionId", "adminResolutionName", "resolutionComment", "resolvedAt",
              "updatedAt"
       FROM patients_images ORDER BY id`,
      { type: QueryTypes.SELECT }
    );
  const imageOf = async (n: number) => (await images()).find((row) => row.id === id(n));
  const resolutions = () =>
    sequelize.query<Record<string, unknown>>(
      `SELECT "patientImageId", label, origin, "resolverId", "resolverName", comment,
              "legacyResolvedAt", "confirmedByName", "supersededAt" IS NOT NULL AS superseded,
              "supersededById", "supersededByName"
       FROM patient_image_review_resolutions ORDER BY "patientImageId"`,
      { type: QueryTypes.SELECT }
    );
  const run = (options: Partial<BackfillModule.ReviewStateBackfillOptions> = {}) =>
    backfill.runReviewStateBackfill(sequelize, { apply: false, ...options });
  const decisions = (...entries: [number, BackfillModule.LegacyResolutionDecision][]) =>
    new Map(entries.map(([n, decision]) => [id(n), decision]));
  const executed = async () => (await migrator.getMigrationStatus(sequelize)).executed;

  // --- Tests ---------------------------------------------------------------------

  it('the schema migrations keep existing rows untouched (state NULL = not derived)', async () => {
    const rows = await images();
    expect(rows.map((row) => [row.reviewState, row.reviewStateSource])).toEqual(
      Array(legacyImages.length).fill([null, null])
    );
    expect(await imageOf(5)).toMatchObject({
      status: 'admin_resolved',
      adminResolutionName: LEGACY_NAME,
      resolutionComment: LEGACY_COMMENT,
    });
  });

  it('the required-state migration refuses while states are not derived, changing nothing', async () => {
    await expect(migrator.migrateUp(sequelize)).rejects.toThrow(/8 image\(s\) have no derived review state/);
    expect(await executed()).not.toContain(REVIEW_REQUIRED);
    const { columns } = await migrator.readActualSchema(sequelize);
    expect(columns.patients_images.reviewState).toEqual({ type: 'varchar', nullable: true });
    // The backend requires every migration.
    await expect(migrator.assertSchemaUpToDate(sequelize)).rejects.toThrow(REVIEW_REQUIRED);
  });

  it('audit lists the ambiguous legacy resolutions and the images to derive', async () => {
    const report = await backfill.runReviewStateAudit(sequelize);
    expect(report.summary).toMatchObject({
      images: 8,
      derived: 0,
      notDerived: 8,
      ambiguousLegacyResolutions: 2,
      cacheMismatches: 0,
      votesWithoutHistory: 11,
      reviewStateRequired: 0,
    });
    expect(report.ambiguous).toEqual([
      { imageId: id(5), clusterId: CLUSTER, legacyFields: ['status', 'adminResolutionId', 'adminResolutionName', 'resolutionComment', 'resolvedAt'], votes: { normal: 1, abnormal: 0, uncertain: 0 } },
      { imageId: id(6), clusterId: CLUSTER, legacyFields: ['status', 'adminResolutionName', 'resolvedAt'], votes: { normal: 0, abnormal: 1, uncertain: 0 } },
    ]);
  });

  it('dry-run writes nothing and reports the planned states and cache changes', async () => {
    const before = await images();
    const report = await run();

    expect(await images()).toEqual(before);
    expect(await resolutions()).toEqual([]);
    expect(report.summary).toMatchObject({
      images: 8,
      notDerived: 8,
      derived: 6,
      ambiguousLegacyResolutions: 2,
      counterCorrections: 1,
      remainingNotDerived: 2,
    });
    expect(report.states).toEqual({
      'NOT_REVIEWED/NONE': 2,
      'CONFLICTED/VOTES': 1,
      'UNCERTAIN/VOTES': 1,
      'ABNORMAL/VOTES': 1,
      'NORMAL/VOTES': 1,
    });
    expect(report.statusTransitions).toEqual({
      'normal->not_reviewed': 1,
      'normal->conflicted': 1,
      'conflicted->uncertain': 1,
    });
  });

  it('apply derives unambiguous images, leaves ambiguous ones untouched, keeps updatedAt', async () => {
    const before = await images();
    const report = await run({ apply: true });

    expect(report.summary).toMatchObject({ derived: 6, ambiguousLegacyResolutions: 2, remainingNotDerived: 2 });
    expect(await imageOf(1)).toMatchObject({ reviewState: 'NOT_REVIEWED', reviewStateSource: 'NONE', status: 'not_reviewed' });
    expect(await imageOf(2)).toMatchObject({ reviewState: 'CONFLICTED', status: 'conflicted', isAbnormal: false });
    expect(await imageOf(3)).toMatchObject({ reviewState: 'UNCERTAIN', status: 'uncertain' });
    expect(await imageOf(4)).toMatchObject({ reviewState: 'ABNORMAL', isAbnormal: true });
    expect(await imageOf(7)).toMatchObject({ reviewState: 'NOT_REVIEWED', status: 'broken' });
    expect(await imageOf(8)).toMatchObject({ reviewState: 'NORMAL', votesCount: 1, normalVotes: 1 });
    // Ambiguous legacy resolutions: exactly as they were.
    for (const n of [5, 6]) {
      expect(await imageOf(n)).toEqual(before.find((row) => row.id === id(n)));
    }
    for (const row of await images()) {
      expect(row.updatedAt).toEqual(before.find(({ id: rowId }) => rowId === row.id)?.updatedAt);
    }
    // No completions are ever created by the backfill.
    expect(await sequelize.query('SELECT 1 FROM patient_image_review_completions', { type: QueryTypes.SELECT })).toEqual([]);
    await expect(migrator.migrateUp(sequelize)).rejects.toThrow(/2 image\(s\)/);
  });

  it('LABEL: a legacy resolution confirmed by an operator keeps its historical data', async () => {
    const report = await run({
      apply: true,
      decisions: decisions([5, ReviewResolutionLabel.ABNORMAL], [6, ReviewResolutionLabel.NORMAL]),
      operator: 'Operator One',
    });

    expect(report.decisions).toEqual([
      { imageId: id(5), decision: 'ABNORMAL', operator: 'Operator One', outcome: 'applied' },
      { imageId: id(6), decision: 'NORMAL', operator: 'Operator One', outcome: 'applied' },
    ]);
    expect(await resolutions()).toEqual([
      {
        patientImageId: id(5),
        label: 'ABNORMAL',
        origin: 'legacy_confirmed',
        resolverId: 'legacy-admin-sub',
        resolverName: LEGACY_NAME,
        comment: LEGACY_COMMENT,
        legacyResolvedAt: new Date(LEGACY_TIME),
        confirmedByName: 'Operator One',
        superseded: false,
        supersededById: null,
        supersededByName: null,
      },
      expect.objectContaining({
        patientImageId: id(6),
        label: 'NORMAL',
        origin: 'legacy_confirmed',
        // Not recorded in the legacy data: stays unknown, never invented.
        resolverId: null,
        resolverName: LEGACY_NAME,
        comment: null,
        superseded: false,
      }),
    ]);
    // The resolution decides; the compatibility fields keep the legacy values.
    expect(await imageOf(5)).toMatchObject({
      reviewState: 'ABNORMAL',
      reviewStateSource: 'RESOLUTION',
      status: 'admin_resolved',
      isAbnormal: true,
      adminResolutionId: 'legacy-admin-sub',
      adminResolutionName: LEGACY_NAME,
      resolutionComment: LEGACY_COMMENT,
      resolvedAt: new Date(LEGACY_TIME),
    });
    // Image 6 has an abnormal vote, but the confirmed resolution wins.
    expect(await imageOf(6)).toMatchObject({ reviewState: 'NORMAL', reviewStateSource: 'RESOLUTION', adminResolutionId: null });
  });

  it('IGNORE: the legacy resolution becomes inactive history; votes decide', async () => {
    await run({ apply: true, decisions: decisions([5, 'IGNORE'], [6, 'IGNORE']), operator: 'Operator Two' });

    expect(await resolutions()).toEqual([
      expect.objectContaining({
        patientImageId: id(5),
        label: null,
        origin: 'legacy_unlabeled',
        resolverId: 'legacy-admin-sub',
        resolverName: LEGACY_NAME,
        comment: LEGACY_COMMENT,
        legacyResolvedAt: new Date(LEGACY_TIME),
        confirmedByName: 'Operator Two',
        superseded: true,
        supersededById: null,
        supersededByName: 'Operator Two',
      }),
      expect.objectContaining({ patientImageId: id(6), origin: 'legacy_unlabeled', superseded: true }),
    ]);
    expect(await imageOf(5)).toMatchObject({
      reviewState: 'NORMAL',
      reviewStateSource: 'VOTES',
      status: 'normal',
      adminResolutionId: null,
      adminResolutionName: null,
      resolutionComment: null,
      resolvedAt: null,
    });
    expect(await imageOf(6)).toMatchObject({ reviewState: 'ABNORMAL', reviewStateSource: 'VOTES', isAbnormal: true });
  });

  it('rejects invalid decisions before writing anything', async () => {
    const before = await images();
    await expect(
      run({ apply: true, decisions: decisions([5, 'IGNORE']), operator: null })
    ).rejects.toThrow('--operator');
    await expect(
      run({ apply: true, decisions: decisions([5, 'IGNORE'], [1, ReviewResolutionLabel.NORMAL]), operator: 'Op' })
    ).rejects.toThrow(`${id(1)}: no legacy resolution`);
    await expect(
      run({ apply: true, decisions: decisions([99, 'IGNORE']), operator: 'Op' })
    ).rejects.toThrow(`${id(99)}: no such image`);
    await expect(run({ apply: true, operator: 'Op' })).rejects.toThrow('only used with');
    expect(await images()).toEqual(before);
    expect(await resolutions()).toEqual([]);
  });

  it('is idempotent; then the required-state migration applies and the audit verifies', async () => {
    const options = {
      apply: true,
      decisions: decisions([5, ReviewResolutionLabel.UNCERTAIN], [6, 'IGNORE']),
      operator: 'Operator',
    };
    await run(options);
    const after = await images();

    const again = await run(options);
    expect(again.summary).toMatchObject({ notDerived: 0, derived: 0, alreadyDerived: 8, remainingNotDerived: 0 });
    expect(again.decisions.map(({ outcome }) => outcome)).toEqual(['already_applied', 'already_applied']);
    expect(await images()).toEqual(after);
    expect(await resolutions()).toHaveLength(2);

    // (Later migrations follow it.)
    expect((await migrator.migrateUp(sequelize)).map(({ name }) => name)[0]).toBe(REVIEW_REQUIRED);
    await expect(migrator.assertSchemaUpToDate(sequelize)).resolves.toBeTruthy();

    const audit = await backfill.runReviewStateAudit(sequelize);
    expect(audit.summary).toMatchObject({
      derived: 8,
      notDerived: 0,
      cacheMismatches: 0,
      legacyResolutionsConfirmed: 1,
      legacyResolutionsIgnored: 1,
      activeResolutions: 1,
      reviewStateRequired: 1,
    });
    // A cache changed behind the service's back is reported.
    await sequelize.query(`UPDATE patients_images SET status = 'normal' WHERE id = $1`, { bind: [id(1)] });
    expect((await backfill.runReviewStateAudit(sequelize)).mismatches).toEqual([
      { imageId: id(1), fields: ['status'] },
    ]);
  });

  it('CLI output and reports carry ids and codes only (no names or comments)', async () => {
    const lines: string[] = [];
    const info = jest.spyOn(console, 'info').mockImplementation((line: string) => void lines.push(line));
    try {
      expect(await cli.runReviewStateAuditCli(sequelize, [])).toBe(1);
      expect(
        await cli.runReviewStateBackfillCli(sequelize, [
          '--apply',
          '--legacy-resolution',
          `${id(5)}=ABNORMAL`,
          '--legacy-resolution',
          `${id(6)}=IGNORE`,
          '--operator',
          'Operator',
        ])
      ).toBe(0);
      expect(await cli.runReviewStateAuditCli(sequelize, [])).toBe(0);
    } finally {
      info.mockRestore();
    }
    const output = lines.join('\n');
    expect(output).toContain(`${id(5)}  fields: status,adminResolutionId,adminResolutionName,resolutionComment,resolvedAt`);
    expect(output).toContain(`legacy resolution  ${id(5)}  ABNORMAL  applied`);
    expect(output).not.toContain(LEGACY_NAME);
    expect(output).not.toContain(LEGACY_COMMENT);
    expect(output).not.toContain('legacy-admin-sub');

    const report = JSON.stringify(await run());
    expect(report).not.toContain(LEGACY_NAME);
    expect(report).not.toContain(LEGACY_COMMENT);
  });
});
