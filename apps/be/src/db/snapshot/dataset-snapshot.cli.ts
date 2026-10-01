/**
 * `node migrate.js dataset-snapshot preview <id> [--report <file.json>]`
 * `node migrate.js dataset-snapshot finalize <id> --operator "<name>"`
 * `node migrate.js dataset-snapshot export <id> --output <dir>`
 *
 * The same service as the HTTP API. Finalization re-hashes every included
 * DICOM file (SHA-256), which can take long: the CLI is the preferred way
 * to finalize large datasets. Export materializes a FINALIZED / ARCHIVED
 * snapshot for the ML side (services/dataset-snapshot/export.ts). Output:
 * ids and counts only (never paths).
 */
import { writeFile } from 'node:fs/promises';
import type { Sequelize } from 'sequelize';
import { assertMigratedThrough } from '../migrator';
import { BackfillPreconditionError } from '../backfill/dicom-metadata.backfill';
import { checkReportPath } from '../backfill/dicom-metadata.cli';
import {
  DatasetSnapshotError,
  finalizeSnapshot,
  previewSnapshot,
} from '../../services/dataset-snapshot/snapshot.service';
import { DatasetExportError, exportSnapshot } from '../../services/dataset-snapshot/export';

export const datasetSnapshotUsage =
  'Usage: node migrate.js dataset-snapshot preview <snapshotId> [--report <file.json>]\n' +
  '       node migrate.js dataset-snapshot finalize <snapshotId> --operator "<name>"\n' +
  '       node migrate.js dataset-snapshot export <snapshotId> --output <new-directory>';

const SENSITIVE_WARNING =
  'WARNING: the export contains ORIGINAL DICOM files (sensitive medical data, not de-identified).\n' +
  'Keep it in the controlled environment; do not upload it to Colab or cloud storage.';

const MAX_OPERATOR_LENGTH = 255;

const printCounts = (title: string, values: Record<string, unknown>) => {
  console.info(title);
  for (const [key, value] of Object.entries(values)) {
    console.info(`  ${key.padEnd(24)} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
};

export const runDatasetSnapshotCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  const [action, id, ...rest] = args;
  if (!['preview', 'finalize', 'export'].includes(action ?? '') || !id) {
    console.error(datasetSnapshotUsage);
    return 2;
  }
  let report: string | null = null;
  let operator: string | null = null;
  let output: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--report' && action === 'preview' && rest[i + 1]) report = rest[++i];
    else if (rest[i] === '--operator' && action === 'finalize' && rest[i + 1]) operator = rest[++i];
    else if (rest[i] === '--output' && action === 'export' && rest[i + 1]) output = rest[++i];
    else throw new BackfillPreconditionError('Unknown or incomplete option.');
  }
  await assertMigratedThrough(sequelize, '202610020000-dataset-snapshots');
  try {
    if (action === 'export') {
      if (!output) throw new BackfillPreconditionError('--output <new-directory> is required to export.');
      console.warn(SENSITIVE_WARNING);
      const summary = await exportSnapshot(id, output, { onProgress: (line) => console.info(line) });
      printCounts('Dataset snapshot exported:', { ...summary });
      console.warn(SENSITIVE_WARNING);
      return 0;
    }
    if (action === 'preview') {
      const reportPath = report ? await checkReportPath(report) : null;
      const preview = await previewSnapshot(id);
      printCounts(`Dataset snapshot preview (${preview.snapshotId}):`, {
        reviewFrozen: preview.reviewFrozen,
        fileVerification: preview.fileVerification,
        eligiblePatients: preview.eligiblePatients,
        eligibleImages: preview.eligibleImages,
        labels: preview.labels,
        bySource: preview.bySource,
        excluded: preview.excluded,
        strata: preview.strata,
        quotas: preview.quotas,
        splits: preview.splits,
        splitError: preview.splitError,
      });
      if (reportPath) {
        await writeFile(reportPath, JSON.stringify(preview, null, 2), { flag: 'wx', mode: 0o600 });
        console.info('Report written.');
      }
      return preview.splitError ? 1 : 0;
    }
    if (!operator?.trim() || operator.length > MAX_OPERATOR_LENGTH) {
      throw new BackfillPreconditionError('--operator "<name>" is required to finalize.');
    }
    const summary = await finalizeSnapshot(
      id,
      { id: 'cli', name: operator },
      { onProgress: (line) => console.info(line) }
    );
    printCounts(`Dataset snapshot finalized (${summary.id}):`, {
      status: summary.status,
      fileVerification: summary.fileVerification,
      reviewFreezeId: summary.reviewFreezeId,
      totalPatients: summary.totalPatients,
      totalImages: summary.totalImages,
      normalImages: summary.normalImages,
      abnormalImages: summary.abnormalImages,
      excludedImages: summary.excludedImages,
      exclusionSummary: summary.exclusionSummary,
      splits: summary.splits,
    });
    return 0;
  } catch (error) {
    if (error instanceof DatasetSnapshotError) {
      console.error(`${error.code}: ${error.message}`);
      return 1;
    }
    if (error instanceof DatasetExportError) {
      console.error(`${error.code}: ${error.message}`);
      const byCode: Record<string, number> = {};
      for (const failure of error.failures) byCode[failure.code] = (byCode[failure.code] ?? 0) + 1;
      if (error.failures.length) {
        printCounts('Failed files by reason:', byCode);
        for (const failure of error.failures) console.error(`  ${failure.patientImageId} ${failure.code}`);
      }
      return 1;
    }
    throw error;
  }
};
