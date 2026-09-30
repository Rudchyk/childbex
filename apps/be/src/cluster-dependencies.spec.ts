/**
 * Repository scan: after migration 202610010000-drop-patient-image-clusters
 * nothing active depends on the removed clusters. Cluster references are
 * allowed only where they are intentionally historical: migrations, the 410
 * handler of the removed API, the pre-removal maintenance commands (which
 * refuse after the removal) and the cluster-removal audit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../..');

const allowed = [
  'apps/be/src/db/migrations/',
  'apps/be/src/api/v1/routes/legacy-clusters.api.routes.ts',
  'apps/be/src/db/backfill/dicom-metadata.backfill.ts',
  'apps/be/src/db/backfill/study-series.backfill.ts',
  'apps/be/src/db/cleanup/duplicate-sop.cleanup.ts',
  'apps/be/src/db/audit/cluster-removal.audit.ts',
];

const clusterDependency =
  /patient_images_clusters|PatientImagesCluster|"clusterId"|\bclusterId\b|scopeClusterId|inReview|finishClusterReview/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return ['node_modules', 'dist', '__fixtures__'].includes(name) ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [full] : [];
  });

describe('no active dependency on the removed clusters', () => {
  it.each([['apps/be/src'], ['apps/gui/src'], ['libs']])('%s', (root) => {
    const offenders = sourceFiles(path.join(repoRoot, root))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
      .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)))
      .filter((file) => clusterDependency.test(readFileSync(path.join(repoRoot, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
