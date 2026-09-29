import { writeFile } from 'node:fs/promises';
import type { Sequelize } from 'sequelize';
import { uploadRoot } from '../../services/storage-roots';
import { BackfillPreconditionError } from './dicom-metadata.backfill';
import { checkReportPath } from './dicom-metadata.cli';
import {
  runStudySeriesBackfill,
  type StudySeriesReport,
} from './study-series.backfill';

export const studySeriesUsage =
  'Usage: node migrate.js backfill study-series [--dry-run | --apply] ' +
  '[--report <file.json>] [--include-trashed]';

export interface StudySeriesCliOptions {
  apply: boolean;
  includeTrashed: boolean;
  report: string | null;
}

/** Parses the options after `backfill study-series`; throws on misuse. */
export const parseStudySeriesArgs = (args: string[]): StudySeriesCliOptions => {
  const options: StudySeriesCliOptions = {
    apply: false,
    includeTrashed: false,
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

const printSummary = ({ run, summary }: StudySeriesReport) => {
  console.info(`Study/Series linking (${run.mode}) summary:`);
  const width = Math.max(...Object.keys(summary).map((key) => key.length));
  for (const [key, value] of Object.entries(summary)) {
    console.info(`  ${key.padEnd(width)}  ${value}`);
  }
  if (run.mode === 'dry-run') {
    console.info('Dry-run: nothing was written. Use --apply to link the images.');
  }
};

export const runStudySeriesCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  const options = parseStudySeriesArgs(args);
  const reportPath = options.report ? await checkReportPath(options.report) : null;

  const report = await runStudySeriesBackfill(sequelize, {
    apply: options.apply,
    includeTrashed: options.includeTrashed,
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
