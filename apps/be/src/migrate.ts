/**
 * Database migration CLI (bundled as `migrate.js` next to `main.js`):
 *
 *   node migrate.js up                  apply all pending migrations
 *   node migrate.js up --to <name>      apply pending migrations up to <name>
 *   node migrate.js status              list applied / pending migrations
 *   node migrate.js down                revert the latest migration
 *   node migrate.js baseline --check    compare an existing schema (read-only)
 *   node migrate.js baseline --apply    mark an existing schema as migrated
 *   node migrate.js backfill dicom-metadata [--apply] [...]
 *                                       fill image metadata from stored files
 *                                       (dry-run unless --apply)
 *   node migrate.js backfill study-series [--apply] [...]
 *                                       link images to Study / Series
 *                                       (dry-run unless --apply)
 *   node migrate.js audit review-state [--report <file>]
 *                                       verify the review state of images
 *                                       (read-only)
 *   node migrate.js backfill review-state [--apply] [--legacy-resolution
 *       <imageId>=<NORMAL|ABNORMAL|UNCERTAIN|IGNORE> --operator <name>] [...]
 *                                       derive the review state of existing
 *                                       images (dry-run unless --apply)
 *   node migrate.js cleanup duplicate-sop [--apply] [--group k-...] [...]
 *                                       audit / clean legacy duplicate SOP
 *                                       instances (dry-run unless --apply)
 *
 * Uses the same environment (DB_*) as the backend. See db/README.md.
 */
import 'dotenv/config';
import { sequelize } from './db/sequelize';
import {
  applyBaseline,
  checkBaseline,
  getMigrationStatus,
  migrateDown,
  migrateUp,
  migrationsTableName,
  type SchemaComparison,
} from './db/migrator';
import { backfillUsage, runBackfillCli } from './db/backfill/dicom-metadata.cli';
import {
  runStudySeriesCli,
  studySeriesUsage,
} from './db/backfill/study-series.cli';
import {
  reviewStateAuditUsage,
  reviewStateBackfillUsage,
  runReviewStateAuditCli,
  runReviewStateBackfillCli,
} from './db/backfill/review-state.cli';
import {
  duplicateSopUsage,
  runDuplicateSopCli,
} from './db/cleanup/duplicate-sop.cli';

const usage =
  'Usage: node migrate.js <up [--to <migration>] | status | down | baseline --check | baseline --apply' +
  ' | backfill dicom-metadata [options] | backfill study-series [options]' +
  ' | backfill review-state [options] | audit review-state [options]' +
  ' | cleanup duplicate-sop [options]>';

const printComparison = ({ errors, warnings }: SchemaComparison) => {
  for (const error of errors) console.error(`ERROR    ${error}`);
  for (const warning of warnings) console.warn(`WARNING  ${warning}`);
  console.info(
    `Baseline check: ${errors.length} error(s), ${warnings.length} warning(s).`
  );
};

const run = async (
  command?: string,
  flag?: string,
  ...rest: string[]
): Promise<number> => {
  switch (command) {
    case 'cleanup': {
      if (flag === 'duplicate-sop') return runDuplicateSopCli(sequelize, rest);
      console.error(duplicateSopUsage);
      return 2;
    }
    case 'audit': {
      if (flag === 'review-state') return runReviewStateAuditCli(sequelize, rest);
      console.error(reviewStateAuditUsage);
      return 2;
    }
    case 'backfill': {
      if (flag === 'dicom-metadata') return runBackfillCli(sequelize, rest);
      if (flag === 'study-series') return runStudySeriesCli(sequelize, rest);
      if (flag === 'review-state') {
        return runReviewStateBackfillCli(sequelize, rest);
      }
      console.error(
        `${backfillUsage}\n${studySeriesUsage}\n${reviewStateBackfillUsage}`
      );
      return 2;
    }
    case 'up': {
      // `up --to <name>`: stop after that migration (e.g. to run a backfill
      // or cleanup a later migration depends on).
      if (flag !== undefined && (flag !== '--to' || !rest[0] || rest.length > 1)) {
        console.error(usage);
        return 2;
      }
      const applied = await migrateUp(sequelize, undefined, {
        to: flag === '--to' ? rest[0] : undefined,
      });
      if (!applied.length) console.info('No pending migrations.');
      for (const { name } of applied) console.info(`applied   ${name}`);
      return 0;
    }
    case 'down': {
      const reverted = await migrateDown(sequelize);
      if (!reverted.length) console.info('No applied migrations to revert.');
      for (const { name } of reverted) console.info(`reverted  ${name}`);
      return 0;
    }
    case 'status': {
      const status = await getMigrationStatus(sequelize);
      if (!status.initialized) {
        console.info(
          `"${migrationsTableName}" does not exist: the database was never ` +
            'migrated (new database: run "up"; existing database: run ' +
            '"baseline --check").'
        );
      }
      for (const name of status.executed) console.info(`applied   ${name}`);
      for (const name of status.pending) console.info(`pending   ${name}`);
      for (const name of status.unknown) {
        console.warn(`unknown   ${name} (applied, not known to this version)`);
      }
      return status.initialized && !status.pending.length ? 0 : 1;
    }
    case 'baseline': {
      if (flag === '--check') {
        const comparison = await checkBaseline(sequelize);
        printComparison(comparison);
        return comparison.errors.length ? 1 : 0;
      }
      if (flag === '--apply') {
        printComparison(await applyBaseline(sequelize));
        console.info('Baseline recorded; the schema itself was not changed.');
        return 0;
      }
      console.error(usage);
      return 2;
    }
    default:
      console.error(usage);
      return 2;
  }
};

const [command, flag, ...rest] = process.argv.slice(2);

run(command, flag, ...rest)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: Error) => {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
