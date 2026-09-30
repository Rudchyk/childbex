/**
 * Dataset snapshot configuration, schema version 1 (pure). The stored
 * configuration is fully resolved (every default written out), so an old
 * snapshot is never reinterpreted with newer defaults; an unknown schema
 * version is rejected.
 */
import { randomBytes } from 'node:crypto';
import {
  DatasetReviewSource,
  DatasetSnapshotConfigV1Schema,
  DATASET_SCHEMA_VERSION,
  Value,
  type DatasetSnapshotConfigInput,
  type DatasetSnapshotConfigV1,
} from '@libs/schemas';

export class DatasetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetConfigError';
  }
}

export const DEFAULT_SPLIT = { train: 0.7, validation: 0.15, test: 0.15 } as const;

/** Ratios must sum to 1 (to floating point precision). */
const RATIO_SUM_TOLERANCE = 1e-9;

export const newSplitSeed = () => randomBytes(16).toString('hex');

/**
 * The resolved v1 configuration: `input` over `base` (the stored one when a
 * DRAFT is edited), then the defaults. Throws DatasetConfigError.
 */
export const resolveConfig = (
  input: DatasetSnapshotConfigInput = {},
  base?: DatasetSnapshotConfigV1
): DatasetSnapshotConfigV1 => {
  const split = { ...DEFAULT_SPLIT, ...base?.split, ...input.split };
  const config: DatasetSnapshotConfigV1 = {
    datasetSchemaVersion: 1,
    task: 'CT_SLICE_BINARY_CLASSIFICATION',
    labels: ['NORMAL', 'ABNORMAL'],
    includeReviewSources: [
      ...(input.includeReviewSources ??
        base?.includeReviewSources ?? [
          DatasetReviewSource.VOTES,
          DatasetReviewSource.RESOLUTION,
          DatasetReviewSource.FINISH_REVIEW,
        ]),
    ],
    requireFullyReviewableSeries: true,
    excludeBroken: true,
    finalizationFileVerification: 'SHA256_REHASHED',
    split: {
      train: split.train,
      validation: split.validation,
      test: split.test,
      seed: input.split?.seed ?? base?.split.seed ?? newSplitSeed(),
      stratifyBy: 'PATIENT_LABEL_MIX',
      minPatientsPerSplit: split.minPatientsPerSplit ?? 1,
      algorithm: 'GLOBAL_QUOTAS_STRATIFIED_SHA256_RANK_V1',
    },
  };
  return validateConfig(config);
};

/** Validates a stored configuration (schema version and ratios). */
export const validateConfig = (config: unknown): DatasetSnapshotConfigV1 => {
  const version = (config as { datasetSchemaVersion?: unknown })?.datasetSchemaVersion;
  if (version !== DATASET_SCHEMA_VERSION) {
    throw new DatasetConfigError(`Unsupported dataset schema version ${String(version)}.`);
  }
  if (!Value.Check(DatasetSnapshotConfigV1Schema, config)) {
    throw new DatasetConfigError('Invalid dataset snapshot configuration.');
  }
  const { train, validation, test } = config.split;
  if (Math.abs(train + validation + test - 1) > RATIO_SUM_TOLERANCE) {
    throw new DatasetConfigError('The train, validation and test ratios must sum to 1.');
  }
  return config;
};
