import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Sequelize } from 'sequelize';
import { archivesRoot, uploadRoot } from '../../services/storage-roots';
import {
  BackfillPreconditionError,
  runDicomMetadataBackfill,
  type BackfillReport,
} from './dicom-metadata.backfill';

export const backfillUsage =
  'Usage: node migrate.js backfill dicom-metadata [--dry-run | --apply] ' +
  '[--batch-size <1-1000>] [--report <file.json>] [--include-trashed] [--rescan]';

export interface BackfillCliOptions {
  apply: boolean;
  batchSize: number;
  includeTrashed: boolean;
  rescan: boolean;
  report: string | null;
}

/** Parses the options after `backfill dicom-metadata`; throws on misuse. */
export const parseBackfillArgs = (args: string[]): BackfillCliOptions => {
  const options: BackfillCliOptions = {
    apply: false,
    batchSize: 200,
    includeTrashed: false,
    rescan: false,
    report: null,
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
      case '--include-trashed':
        options.includeTrashed = true;
        break;
      case '--rescan':
        options.rescan = true;
        break;
      case '--batch-size':
        options.batchSize = Number(args[++i]);
        break;
      case '--report':
        options.report = args[++i] ?? '';
        break;
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
  return options;
};

const isWithin = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * The report must not land in the image or archive storage and never
 * replaces an existing file. Checked before the run starts.
 */
export const checkReportPath = async (report: string) => {
  const target = path.resolve(report);
  if ([uploadRoot, archivesRoot].some((root) => isWithin(root, target))) {
    throw new BackfillPreconditionError(
      'The report must not be written inside the upload or archive storage.'
    );
  }
  if (await stat(target).catch(() => null)) {
    throw new BackfillPreconditionError('The report file already exists.');
  }
  const directory = await stat(path.dirname(target)).catch(() => null);
  if (!directory?.isDirectory()) {
    throw new BackfillPreconditionError(
      'The directory of the report file does not exist.'
    );
  }
  return target;
};

const printSummary = ({ run, summary }: BackfillReport) => {
  console.info(`DICOM metadata backfill (${run.mode}) summary:`);
  const width = Math.max(...Object.keys(summary).map((key) => key.length));
  for (const [key, value] of Object.entries(summary)) {
    console.info(`  ${key.padEnd(width)}  ${value}`);
  }
  if (run.mode === 'dry-run') {
    console.info('Dry-run: nothing was written. Use --apply to fill the rows.');
  }
};

export const runBackfillCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  const options = parseBackfillArgs(args);
  const reportPath = options.report ? await checkReportPath(options.report) : null;

  const report = await runDicomMetadataBackfill(sequelize, {
    apply: options.apply,
    batchSize: options.batchSize,
    includeTrashed: options.includeTrashed,
    rescan: options.rescan,
    uploadRoot,
    hmacKey: process.env.REPORT_HMAC_KEY ?? '',
    onProgress: (line) => console.info(line),
  });

  printSummary(report);
  if (reportPath) {
    // `wx`: never overwrite a file created meanwhile.
    await writeFile(reportPath, JSON.stringify(report, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    console.info('Report written.');
  }
  return 0;
};
