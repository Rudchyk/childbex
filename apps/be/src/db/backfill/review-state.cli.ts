import { writeFile } from 'node:fs/promises';
import type { Sequelize } from 'sequelize';
import { BackfillPreconditionError } from './dicom-metadata.backfill';
import { checkReportPath } from './dicom-metadata.cli';
import {
  legacyResolutionDecisions,
  runReviewStateAudit,
  runReviewStateBackfill,
  type LegacyResolutionDecision,
} from './review-state.backfill';

export const reviewStateAuditUsage =
  'Usage: node migrate.js audit review-state [--report <file.json>]';

export const reviewStateBackfillUsage =
  'Usage: node migrate.js backfill review-state [--dry-run | --apply] ' +
  '[--report <file.json>] ' +
  '[--legacy-resolution <imageId>=<NORMAL|ABNORMAL|UNCERTAIN|IGNORE> ...] ' +
  '[--operator "<name>"]';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReviewStateCliOptions {
  apply: boolean;
  report: string | null;
  decisions: Map<string, LegacyResolutionDecision>;
  operator: string | null;
}

/** Parses the options after `backfill review-state`; throws on misuse. */
export const parseReviewStateBackfillArgs = (
  args: string[]
): ReviewStateCliOptions => {
  const options: ReviewStateCliOptions = {
    apply: false,
    report: null,
    decisions: new Map(),
    operator: null,
  };
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--report':
        options.report = args[++i] ?? '';
        break;
      case '--operator':
        options.operator = args[++i] ?? '';
        break;
      case '--legacy-resolution': {
        const value = args[++i] ?? '';
        const [imageId, decision, ...extra] = value.split('=');
        if (
          extra.length ||
          !UUID.test(imageId ?? '') ||
          !legacyResolutionDecisions.includes(decision as LegacyResolutionDecision)
        ) {
          throw new BackfillPreconditionError(
            '--legacy-resolution needs <imageId>=<NORMAL|ABNORMAL|UNCERTAIN|IGNORE>.'
          );
        }
        const id = imageId.toLowerCase();
        if (options.decisions.has(id)) {
          throw new BackfillPreconditionError(
            `--legacy-resolution given twice for ${id}.`
          );
        }
        options.decisions.set(id, decision as LegacyResolutionDecision);
        break;
      }
      default:
        throw new BackfillPreconditionError(`Unknown option "${arg}".`);
    }
  }
  if (options.apply && dryRun) {
    throw new BackfillPreconditionError('Use either --dry-run or --apply.');
  }
  if (options.report === '') {
    throw new BackfillPreconditionError('--report needs a file name.');
  }
  if (options.decisions.size && !options.operator?.trim()) {
    throw new BackfillPreconditionError(
      '--operator "<name>" is required with --legacy-resolution.'
    );
  }
  return options;
};

const printTable = (title: string, values: Record<string, number>) => {
  console.info(title);
  const keys = Object.keys(values);
  if (!keys.length) return console.info('  (none)');
  const width = Math.max(...keys.map((key) => key.length));
  for (const [key, value] of Object.entries(values)) {
    console.info(`  ${key.padEnd(width)}  ${value}`);
  }
};

const writeReport = async (reportPath: string | null, report: unknown) => {
  if (!reportPath) return;
  // `wx`: never overwrite a file created meanwhile.
  await writeFile(reportPath, JSON.stringify(report, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  console.info('Report written.');
};

/** Ids only (internal UUIDs): no names, comments or DICOM data. */
const printAmbiguous = (
  ambiguous: { imageId: string; legacyFields: string[] }[]
) => {
  if (!ambiguous.length) return;
  console.info(
    'Ambiguous legacy resolutions (left untouched; decide with ' +
      '--legacy-resolution <imageId>=<NORMAL|ABNORMAL|UNCERTAIN|IGNORE>):'
  );
  for (const { imageId, legacyFields } of ambiguous) {
    console.info(`  ${imageId}  fields: ${legacyFields.join(',')}`);
  }
};

export const runReviewStateAuditCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  let report: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && args[i + 1]) report = args[++i];
    else throw new BackfillPreconditionError(`Unknown option "${args[i]}".`);
  }
  const reportPath = report ? await checkReportPath(report) : null;
  const result = await runReviewStateAudit(sequelize);
  printTable('Review state audit summary:', result.summary);
  printTable('Review states (derived images):', result.states);
  printAmbiguous(result.ambiguous);
  for (const { imageId, fields } of result.mismatches) {
    console.info(`  cache mismatch  ${imageId}  fields: ${fields.join(',')}`);
  }
  await writeReport(reportPath, result);
  return result.summary.notDerived || result.summary.cacheMismatches ? 1 : 0;
};

export const runReviewStateBackfillCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  const options = parseReviewStateBackfillArgs(args);
  const reportPath = options.report
    ? await checkReportPath(options.report)
    : null;
  const report = await runReviewStateBackfill(sequelize, {
    apply: options.apply,
    decisions: options.decisions,
    operator: options.operator,
    onProgress: (line) => console.info(line),
  });
  printTable(`Review state backfill (${report.run.mode}) summary:`, report.summary);
  printTable('Review states (derived images):', report.states);
  printTable('Legacy status cache changes:', report.statusTransitions);
  printAmbiguous(report.ambiguous);
  for (const { imageId, decision, outcome } of report.decisions) {
    console.info(`  legacy resolution  ${imageId}  ${decision}  ${outcome}`);
  }
  if (report.run.mode === 'dry-run') {
    console.info('Dry-run: nothing was written. Use --apply to store the states.');
  }
  await writeReport(reportPath, report);
  return 0;
};
