import { writeFile } from 'node:fs/promises';
import type { Sequelize } from 'sequelize';
import { uploadRoot } from '../../services/storage-roots';
import { BackfillPreconditionError } from '../backfill/dicom-metadata.backfill';
import { checkReportPath } from '../backfill/dicom-metadata.cli';
import {
  runDuplicateSopCleanup,
  type DuplicateSopReport,
} from './duplicate-sop.cleanup';

export const duplicateSopUsage =
  'Usage: node migrate.js cleanup duplicate-sop [--dry-run | --apply] ' +
  '[--report <file.json>] [--group <k-... key from a report>]';

export interface DuplicateSopCliOptions {
  apply: boolean;
  report: string | null;
  group: string | null;
}

const GROUP_KEY = /^k-[0-9a-f]{16}$/;

/** Parses the options after `cleanup duplicate-sop`; throws on misuse. */
export const parseDuplicateSopArgs = (
  args: string[]
): DuplicateSopCliOptions => {
  const options: DuplicateSopCliOptions = {
    apply: false,
    report: null,
    group: null,
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
      case '--group':
        options.group = args[++i] ?? '';
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
  if (options.group !== null && !GROUP_KEY.test(options.group)) {
    throw new BackfillPreconditionError(
      '--group needs a group key from a report (k- followed by 16 hex digits).'
    );
  }
  return options;
};

const printSummary = ({ run, summary }: DuplicateSopReport) => {
  console.info(`Duplicate SOP Instance UID cleanup (${run.mode}) summary:`);
  const width = Math.max(...Object.keys(summary).map((key) => key.length));
  for (const [key, value] of Object.entries(summary)) {
    console.info(`  ${key.padEnd(width)}  ${value}`);
  }
  if (run.options.group && summary.duplicateGroups === 0) {
    console.info('No duplicate group with this key (already clean?).');
  }
  if (run.mode === 'dry-run') {
    console.info(
      'Dry-run: nothing was changed. Use --apply to clean SAFE_IDENTICAL groups.'
    );
  }
};

export const runDuplicateSopCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  const options = parseDuplicateSopArgs(args);
  const reportPath = options.report
    ? await checkReportPath(options.report)
    : null;

  const report = await runDuplicateSopCleanup(sequelize, {
    apply: options.apply,
    group: options.group,
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
