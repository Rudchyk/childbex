/**
 * `node migrate.js audit cluster-removal` (read-only): whether migration
 * 202610010000-drop-patient-image-clusters can run. Reports exactly its
 * preflight checks, plus information for the operator. Counts and internal
 * image UUIDs only (no names, paths or DICOM data).
 */
import { writeFile } from 'node:fs/promises';
import { QueryTypes, type Sequelize } from 'sequelize';
import { readExecutedMigrations } from '../migrator';
import {
  CLUSTER_REMOVAL_MIGRATION,
  findClusterRemovalBlockers,
  hasClusterRemovalBlockers,
  type ClusterRemovalBlockers,
} from '../migrations/202610010000-drop-patient-image-clusters';
import { BackfillPreconditionError } from '../backfill/dicom-metadata.backfill';
import { checkReportPath } from '../backfill/dicom-metadata.cli';

export const clusterRemovalAuditUsage =
  'Usage: node migrate.js audit cluster-removal [--report <file.json>]';

export interface ClusterRemovalAuditReport {
  run: { startedAt: string; finishedAt: string };
  /** The migration was already applied (the clusters are gone). */
  clustersRemoved: boolean;
  /** No blocker: the migration can run. */
  ready: boolean;
  blockers: ClusterRemovalBlockers;
  info: {
    images: number;
    clusters: number | null;
    /** Completions whose provenance is a cluster (kept as legacy provenance). */
    clusterScopedCompletions: number;
    reviewFrozen: boolean;
  };
}

const count = async (sequelize: Sequelize, sql: string) =>
  (
    await sequelize.query<{ n: number }>(sql, {
      type: QueryTypes.SELECT,
      plain: true,
    })
  )?.n ?? 0;

export const runClusterRemovalAudit = async (
  sequelize: Sequelize
): Promise<ClusterRemovalAuditReport> => {
  const startedAt = new Date().toISOString();
  const executed = (await readExecutedMigrations(sequelize)) ?? [];
  if (!executed.includes('202609302100-review-completion-series-scope')) {
    throw new BackfillPreconditionError(
      'Apply the migrations up to 202609302100-review-completion-series-scope first.'
    );
  }
  const clustersRemoved = executed.includes(CLUSTER_REMOVAL_MIGRATION);
  const blockers = await findClusterRemovalBlockers(sequelize);
  const report: ClusterRemovalAuditReport = {
    run: { startedAt, finishedAt: startedAt },
    clustersRemoved,
    ready: !hasClusterRemovalBlockers(blockers),
    blockers,
    info: {
      images: await count(sequelize, 'SELECT count(*)::int AS n FROM patients_images'),
      clusters: clustersRemoved
        ? null
        : await count(sequelize, 'SELECT count(*)::int AS n FROM patient_images_clusters'),
      clusterScopedCompletions: await count(
        sequelize,
        `SELECT count(*)::int AS n FROM patient_image_review_completions
         WHERE "${clustersRemoved ? 'legacyScopeClusterId' : 'scopeClusterId'}" IS NOT NULL`
      ),
      reviewFrozen:
        (await count(
          sequelize,
          'SELECT count(*)::int AS n FROM review_freezes WHERE "unfrozenAt" IS NULL'
        )) > 0,
    },
  };
  report.run.finishedAt = new Date().toISOString();
  return report;
};

export const runClusterRemovalAuditCli = async (
  sequelize: Sequelize,
  args: string[]
): Promise<number> => {
  let report: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--report' && args[i + 1]) report = args[++i];
    else throw new BackfillPreconditionError(`Unknown option "${args[i]}".`);
  }
  const reportPath = report ? await checkReportPath(report) : null;
  const result = await runClusterRemovalAudit(sequelize);
  const { withoutSeries, unverifiedMetadata } = result.blockers;
  console.info('Cluster removal audit:');
  console.info(`  clustersRemoved              ${result.clustersRemoved}`);
  console.info(`  images                       ${result.info.images}`);
  console.info(`  clusters                     ${result.info.clusters ?? '-'}`);
  console.info(`  imagesWithoutSeries          ${withoutSeries.total} (broken ${withoutSeries.broken})`);
  console.info(`  imagesWithUnverifiedMetadata ${unverifiedMetadata.total} (broken ${unverifiedMetadata.broken})`);
  console.info(`  clusterScopedCompletions     ${result.info.clusterScopedCompletions} (kept as legacy provenance)`);
  console.info(`  reviewFrozen                 ${result.info.reviewFrozen}`);
  for (const id of withoutSeries.ids) console.info(`  without series     ${id}`);
  for (const id of unverifiedMetadata.ids) console.info(`  unverified metadata ${id}`);
  console.info(
    result.ready
      ? 'Ready: the cluster removal migration can run.'
      : 'NOT ready: the cluster removal migration would refuse (see db/README.md).'
  );
  if (reportPath) {
    await writeFile(reportPath, JSON.stringify(result, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    console.info('Report written.');
  }
  return result.ready ? 0 : 1;
};
