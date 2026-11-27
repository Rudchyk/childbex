/**
 * Local PostgreSQL integration test gate (Issue #71).
 *
 * The backend integration suites skip themselves (describe.skip) when
 * TEST_DATABASE_URL is not set, so a green `nx run be:test` proves nothing
 * about them. This gate:
 *
 *   1. refuses an unsafe or missing TEST_DATABASE_URL: the database must be
 *      exactly "childbex_test", the host local, the port 5432 or unset, and
 *      no query parameters (they could change the connection) or fragment;
 *   2. connects (fails when the database is unreachable) and checks what
 *      the server reports: current_database() is childbex_test, on a
 *      loopback address and port 5432; prints the PostgreSQL version;
 *   3. checks that the integration spec files on disk match the inventory
 *      below (a required suite removed, or a new one not listed, fails);
 *   4. runs the integration suites through the be:test Jest executor with
 *      --skip-nx-cache, in band (one suite at a time; each suite uses its
 *      own database), writing a Jest JSON report;
 *   5. fails unless every required suite ran with > 0 passing tests and no
 *      failed, skipped, pending or todo tests.
 *
 * Usage (see apps/be/src/db/README.md, "Tests"):
 *   TEST_DATABASE_URL=postgres://u:p@localhost:5432/childbex_test \
 *     npm run be:test:integration
 *   npm run be:test:integration -- --self-test
 *
 * Never point TEST_DATABASE_URL at a development, production or shared
 * database: the suites drop and recreate the `public` schema of "<name>"
 * and of the "<name>_<suffix>" databases (created when missing).
 */
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SPEC_ROOT = 'apps/be/src';

/** Every PostgreSQL-dependent suite; all are required. */
const REQUIRED_SUITES = [
  'apps/be/src/db/backfill/dicom-metadata.integration.spec.ts',
  'apps/be/src/db/backfill/review-state.integration.spec.ts',
  'apps/be/src/db/backfill/study-series.integration.spec.ts',
  'apps/be/src/db/cleanup/duplicate-sop.integration.spec.ts',
  'apps/be/src/db/cluster-removal.integration.spec.ts',
  'apps/be/src/db/migrations.integration.spec.ts',
  'apps/be/src/db/sop-unique.integration.spec.ts',
  'apps/be/src/services/dataset-snapshot/dataset-snapshot.integration.spec.ts',
  'apps/be/src/services/hierarchy.integration.spec.ts',
  'apps/be/src/services/instance-dedup.integration.spec.ts',
  'apps/be/src/services/review.integration.spec.ts',
];

/** The only allowed base test database (the suites derive "<it>_<suffix>"). */
const TEST_DATABASE = 'childbex_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1)$/;

/** Problems with TEST_DATABASE_URL (empty when it is safe to use). */
const checkDatabaseUrl = (value) => {
  if (!value) return ['TEST_DATABASE_URL is not set.'];
  let url;
  try {
    url = new URL(value);
  } catch {
    return ['TEST_DATABASE_URL is not a valid URL.'];
  }
  const problems = [];
  if (!/^postgres(ql)?:$/.test(url.protocol)) problems.push('TEST_DATABASE_URL must use postgres://.');
  if (url.pathname !== `/${TEST_DATABASE}`) problems.push(`TEST_DATABASE_URL must name the database "${TEST_DATABASE}".`);
  if (!LOCAL_HOSTS.has(url.hostname)) problems.push('TEST_DATABASE_URL must point at the local server.');
  if (url.port && url.port !== '5432') problems.push('TEST_DATABASE_URL must use port 5432 (DB_* has no port).');
  // e.g. ?host=, ?port=, ?options=, ?sslmode= would override the URL.
  if (value.includes('?')) problems.push('TEST_DATABASE_URL must not have query parameters.');
  if (value.includes('#')) problems.push('TEST_DATABASE_URL must not have a fragment.');
  return problems;
};

/** Problems with the connection the server reports (empty when it is the expected one). */
const checkConnection = ({ database, address, port }) => {
  const problems = [];
  if (database !== TEST_DATABASE) problems.push(`Connected to database "${database}", not "${TEST_DATABASE}".`);
  if (!LOOPBACK.test(address ?? '')) problems.push(`Connected to server address ${address ?? '(socket)'}, not loopback.`);
  if (Number(port) !== 5432) problems.push(`Connected to server port ${port}, not 5432.`);
  return problems;
};

/** Integration spec files on disk, as repository-relative POSIX paths. */
const discoverSuites = () =>
  readdirSync(path.join(ROOT, SPEC_ROOT), { recursive: true })
    .map((file) => `${SPEC_ROOT}/${String(file).split(path.sep).join('/')}`)
    .filter((file) => file.endsWith('.integration.spec.ts'))
    .sort();

const inventoryProblems = (discovered, required = REQUIRED_SUITES) => [
  ...required.filter((f) => !discovered.includes(f)).map((f) => `Required suite is missing: ${f}`),
  ...discovered
    .filter((f) => !required.includes(f))
    .map((f) => `Integration suite not in the gate inventory (add it to REQUIRED_SUITES): ${f}`),
];

/**
 * Evaluates a Jest --json report. Returns per-suite counts and every
 * reason the gate must fail.
 */
const evaluateReport = (report, required = REQUIRED_SUITES) => {
  const problems = [];
  const rows = [];
  const byFile = new Map(
    (report.testResults ?? []).map((r) => [path.relative(ROOT, r.name).split(path.sep).join('/'), r])
  );
  for (const file of required) {
    const result = byFile.get(file);
    if (!result) {
      problems.push(`${file}: did not run.`);
      rows.push({ file, passed: 0, failed: 0, skipped: 0, seconds: 0 });
      continue;
    }
    const tests = result.assertionResults ?? [];
    const count = (...statuses) => tests.filter((t) => statuses.includes(t.status)).length;
    const row = {
      file,
      passed: count('passed'),
      failed: count('failed'),
      skipped: count('pending', 'skipped', 'todo', 'disabled'),
      seconds: Math.round(((result.endTime ?? 0) - (result.startTime ?? 0)) / 100) / 10,
    };
    rows.push(row);
    // Other statuses (pending, focused) are reported through the counts.
    if (result.status === 'failed') {
      const message = (result.message ?? '').split('\n').find((line) => line.trim()) ?? '';
      problems.push(`${file}: suite ${result.status}${message ? ` (${message.trim()})` : ''}.`);
    }
    if (row.failed) problems.push(`${file}: ${row.failed} failed test(s).`);
    if (row.skipped) problems.push(`${file}: ${row.skipped} skipped/pending/todo test(s).`);
    if (!row.passed) problems.push(`${file}: zero passing tests.`);
  }
  if (!report.numTotalTests) problems.push('Jest ran zero tests.');
  if (report.numRuntimeErrorTestSuites) problems.push(`${report.numRuntimeErrorTestSuites} suite(s) failed to run.`);
  return { rows, problems };
};

const formatTable = (rows) => {
  const total = rows.reduce(
    (sum, r) => ({ passed: sum.passed + r.passed, failed: sum.failed + r.failed, skipped: sum.skipped + r.skipped }),
    { passed: 0, failed: 0, skipped: 0 }
  );
  return [
    '| Suite | Passed | Failed | Skipped | Seconds |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows.map((r) => `| ${r.file.replace(`${SPEC_ROOT}/`, '')} | ${r.passed} | ${r.failed} | ${r.skipped} | ${r.seconds} |`),
    `| **Total (${rows.length} suites)** | **${total.passed}** | **${total.failed}** | **${total.skipped}** | |`,
  ].join('\n');
};

const summarize = (markdown) => console.log(markdown);

const currentCommit = () => {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return dirty ? `${sha} + uncommitted changes` : sha;
  } catch {
    return 'unknown';
  }
};

const fail = (problems) => {
  summarize(['### PostgreSQL integration gate: FAILED', '', ...problems.map((p) => `- ${p}`)].join('\n'));
  process.exit(1);
};

/** What the server reports about the connection. */
const serverConnection = async (databaseUrl) => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT current_database() AS database, host(inet_server_addr()) AS address,
              inet_server_port() AS port, current_setting('server_version') AS version`
    );
    return rows[0];
  } finally {
    await client.end().catch(() => undefined);
  }
};

const run = async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const urlProblems = checkDatabaseUrl(databaseUrl);
  if (urlProblems.length) fail(urlProblems);

  let connection;
  try {
    connection = await serverConnection(databaseUrl);
  } catch (error) {
    // ECONNREFUSED arrives as an AggregateError with an empty message.
    const reason = [error.code, error.message, ...(error.errors ?? []).map((e) => e.message)]
      .filter(Boolean)
      .join('; ');
    fail([`Test database is unreachable: ${reason}`]);
  }
  const connectionProblems = checkConnection(connection);
  if (connectionProblems.length) fail(connectionProblems);
  const { version } = connection;
  console.log(
    `PostgreSQL server_version: ${version}; connected to ${connection.database} at ${connection.address}:${connection.port}`
  );

  const discovered = discoverSuites();
  const missing = inventoryProblems(discovered);
  if (missing.length) fail(missing);

  const outDir = mkdtempSync(path.join(os.tmpdir(), 'childbex-pg-gate-'));
  const reportFile = path.join(outDir, 'jest-report.json');
  // Through the Nx Jest executor (it loads apps/be/jest.config.ts, which
  // plain Jest cannot on Node 24), never from the Nx cache. The verdict
  // comes only from Jest's JSON report below, not from the exit code.
  const jest = spawnSync(
    process.execPath,
    [
      require.resolve('nx/bin/nx'),
      'run', 'be:test',
      '--skip-nx-cache',
      '--outputStyle=stream',
      '--ci',
      '--runInBand',
      '--json',
      `--outputFile=${reportFile}`,
      '--testPathPatterns=\\.integration\\.spec\\.ts$',
      '--passWithNoTests=false',
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NX_DAEMON: 'false' } }
  );

  let report;
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'));
  } catch {
    fail([`Jest produced no report (exit code ${jest.status}).`]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  const { rows, problems } = evaluateReport(report);
  if (jest.status !== 0 && !problems.length) problems.push(`Jest exited with code ${jest.status}.`);

  summarize(
    [
      `### PostgreSQL integration gate: ${problems.length ? 'FAILED' : 'PASSED'}`,
      '',
      `PostgreSQL ${version}; database ${connection.database}; commit ${currentCommit()}.`,
      '',
      formatTable(rows),
    ].join('\n')
  );
  if (problems.length) fail(problems);
};

/** Shows that each failure mode of the gate is detected. */
const selfTest = () => {
  const assert = require('node:assert/strict');
  const suite = (file, statuses, status = 'passed') => ({
    name: path.join(ROOT, file),
    status,
    message: '',
    startTime: 0,
    endTime: 1000,
    assertionResults: statuses.map((s) => ({ status: s })),
  });
  const required = ['apps/be/src/a.integration.spec.ts', 'apps/be/src/b.integration.spec.ts'];
  const report = (...results) => ({
    numTotalTests: results.reduce((n, r) => n + r.assertionResults.length, 0),
    numRuntimeErrorTestSuites: 0,
    testResults: results,
  });

  // Passing.
  assert.deepEqual(
    evaluateReport(report(suite(required[0], ['passed']), suite(required[1], ['passed', 'passed'])), required).problems,
    []
  );
  // Without TEST_DATABASE_URL every test is skipped (describe.skip).
  assert.match(
    evaluateReport(report(suite(required[0], ['pending']), suite(required[1], ['pending'], 'pending')), required).problems.join('\n'),
    /skipped.*\n.*zero passing/s
  );
  // A partially skipped suite (it.skip / it.only / it.todo).
  assert.match(
    evaluateReport(report(suite(required[0], ['passed', 'todo']), suite(required[1], ['passed'])), required).problems.join(),
    /a\.integration\.spec\.ts: 1 skipped/
  );
  // A required suite that did not run.
  assert.match(evaluateReport(report(suite(required[0], ['passed'])), required).problems.join(), /b\.integration\.spec\.ts: did not run/);
  // Failures, and a suite that failed in beforeAll (e.g. unreachable database).
  assert.match(
    evaluateReport(report(suite(required[0], ['failed']), suite(required[1], ['failed'], 'failed')), required).problems.join(),
    /1 failed test/
  );
  // Zero tests in total.
  assert.match(evaluateReport(report(), required).problems.join(), /zero tests/);
  // Inventory drift.
  assert.deepEqual(inventoryProblems(required, required), []);
  assert.match(inventoryProblems([required[0]], required).join(), /missing: .*b\.integration/);
  assert.match(inventoryProblems([...required, 'apps/be/src/c.integration.spec.ts'], required).join(), /not in the gate inventory/);
  // Database URLs: only childbex_test on the local server, nothing that overrides the connection.
  assert.deepEqual(checkDatabaseUrl('postgres://u:p@localhost:5432/childbex_test'), []);
  assert.deepEqual(checkDatabaseUrl('postgresql://u:p@127.0.0.1/childbex_test'), []);
  assert.deepEqual(checkDatabaseUrl('postgres://u:p@[::1]:5432/childbex_test'), []);
  assert.match(checkDatabaseUrl(undefined).join(), /not set/);
  assert.match(checkDatabaseUrl('not a url').join(), /not a valid URL/);
  assert.match(checkDatabaseUrl('mysql://u:p@localhost:5432/childbex_test').join(), /postgres:\/\//);
  for (const database of [
    'childbex', 'devchildbex', 'app_childbex', 'childbex_migrations_test', 'childbex_test_review',
    'other_test', 'CHILDBEX_TEST', 'childbex%5Ftest', 'childbex_test/x', '',
  ]) {
    assert.match(checkDatabaseUrl(`postgres://u:p@localhost:5432/${database}`).join(), /must name the database "childbex_test"/, database);
  }
  assert.match(checkDatabaseUrl('postgres://u:p@db.example.org:5432/childbex_test').join(), /local server/);
  assert.match(checkDatabaseUrl('postgres://u:p@localhost:5433/childbex_test').join(), /port 5432/);
  for (const query of ['?host=db.example.org', '?port=5433', '?options=-csearch_path%3Dx', '?sslmode=disable', '?dbname=childbex', '?']) {
    assert.match(checkDatabaseUrl(`postgres://u:p@localhost:5432/childbex_test${query}`).join(), /query parameters/, query);
  }
  assert.match(checkDatabaseUrl('postgres://u:p@localhost:5432/childbex_test#x').join(), /fragment/);
  // The connection the server reports.
  assert.deepEqual(checkConnection({ database: 'childbex_test', address: '127.0.0.1', port: 5432 }), []);
  assert.deepEqual(checkConnection({ database: 'childbex_test', address: '::1', port: 5432 }), []);
  assert.match(checkConnection({ database: 'childbex', address: '::1', port: 5432 }).join(), /database "childbex"/);
  assert.match(checkConnection({ database: 'childbex_test', address: '10.0.0.5', port: 5432 }).join(), /not loopback/);
  assert.match(checkConnection({ database: 'childbex_test', address: null, port: 5432 }).join(), /\(socket\), not loopback/);
  assert.match(checkConnection({ database: 'childbex_test', address: '127.0.0.1', port: 5433 }).join(), /port 5433/);
  // The real inventory matches the files on disk.
  assert.deepEqual(inventoryProblems(discoverSuites()), []);
  console.log('postgres-integration-gate self-test: OK');
};

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  run().catch((error) => fail([error.stack ?? String(error)]));
}
