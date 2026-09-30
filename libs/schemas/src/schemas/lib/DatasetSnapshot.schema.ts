import { Type, type Static } from '@sinclair/typebox';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';

/**
 * Versioned, immutable ML dataset snapshots. Responses carry ids, names and
 * counts only: never stored paths, file names, DICOM UIDs or PHI (the admin
 * items manifest additionally carries the verified file SHA-256).
 */

export const DATASET_SCHEMA_VERSION = 1;

export enum DatasetSnapshotStatus {
  DRAFT = 'DRAFT',
  FINALIZED = 'FINALIZED',
  ARCHIVED = 'ARCHIVED',
}

export enum DatasetSplit {
  TRAIN = 'TRAIN',
  VALIDATION = 'VALIDATION',
  TEST = 'TEST',
}

export enum DatasetLabel {
  NORMAL = 'NORMAL',
  ABNORMAL = 'ABNORMAL',
}

export enum DatasetPatientStratum {
  NORMAL_ONLY = 'NORMAL_ONLY',
  ABNORMAL_ONLY = 'ABNORMAL_ONLY',
  MIXED = 'MIXED',
}

/** Why an image is not in the snapshot; the first matching one, in this order. */
export enum DatasetExclusionReason {
  PATIENT_TRASHED = 'PATIENT_TRASHED',
  BROKEN = 'BROKEN',
  SERIES_NOT_FULLY_REVIEWABLE = 'SERIES_NOT_FULLY_REVIEWABLE',
  NOT_REVIEWED = 'NOT_REVIEWED',
  UNCERTAIN = 'UNCERTAIN',
  CONFLICTED = 'CONFLICTED',
  REVIEW_SOURCE_NOT_INCLUDED = 'REVIEW_SOURCE_NOT_INCLUDED',
  MISSING_FILE_HASH = 'MISSING_FILE_HASH',
  MISSING_FILE = 'MISSING_FILE',
  FILE_SIZE_MISMATCH = 'FILE_SIZE_MISMATCH',
  FILE_HASH_MISMATCH = 'FILE_HASH_MISMATCH',
}

export enum DatasetReviewSource {
  VOTES = 'VOTES',
  RESOLUTION = 'RESOLUTION',
  FINISH_REVIEW = 'FINISH_REVIEW',
}

const Ratio = Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 1 });

/** Configuration as given when creating / editing a DRAFT (v1). */
export const DatasetSnapshotConfigInputSchema = Type.Object(
  {
    includeReviewSources: Type.Optional(
      Type.Array(Type.Enum(DatasetReviewSource), { minItems: 1, uniqueItems: true })
    ),
    split: Type.Optional(
      Type.Object(
        {
          train: Type.Optional(Ratio),
          validation: Type.Optional(Ratio),
          test: Type.Optional(Ratio),
          seed: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
          minPatientsPerSplit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);

export type DatasetSnapshotConfigInput = Static<typeof DatasetSnapshotConfigInputSchema>;

/** The stored, fully resolved configuration (schema version 1). */
export const DatasetSnapshotConfigV1Schema = Type.Object(
  {
    datasetSchemaVersion: Type.Literal(1),
    task: Type.Literal('CT_SLICE_BINARY_CLASSIFICATION'),
    labels: Type.Tuple([Type.Literal('NORMAL'), Type.Literal('ABNORMAL')]),
    includeReviewSources: Type.Array(Type.Enum(DatasetReviewSource), {
      minItems: 1,
      uniqueItems: true,
    }),
    requireFullyReviewableSeries: Type.Literal(true),
    excludeBroken: Type.Literal(true),
    /** Finalization always re-hashes every included file (v1). */
    finalizationFileVerification: Type.Literal('SHA256_REHASHED'),
    split: Type.Object(
      {
        train: Ratio,
        validation: Ratio,
        test: Ratio,
        seed: Type.String({ minLength: 1, maxLength: 200 }),
        stratifyBy: Type.Literal('PATIENT_LABEL_MIX'),
        minPatientsPerSplit: Type.Integer({ minimum: 1 }),
        algorithm: Type.Literal('GLOBAL_QUOTAS_STRATIFIED_SHA256_RANK_V1'),
      },
      { additionalProperties: false }
    ),
  },
  { additionalProperties: false }
);

export type DatasetSnapshotConfigV1 = Static<typeof DatasetSnapshotConfigV1Schema>;

export const CreateDatasetSnapshotRequestBodySchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
    configuration: Type.Optional(DatasetSnapshotConfigInputSchema),
  },
  { additionalProperties: false }
);

export type CreateDatasetSnapshotRequestBody = Static<
  typeof CreateDatasetSnapshotRequestBodySchema
>;

export const UpdateDatasetSnapshotRequestBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    description: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
    configuration: Type.Optional(DatasetSnapshotConfigInputSchema),
  },
  { additionalProperties: false, minProperties: 1 }
);

export type UpdateDatasetSnapshotRequestBody = Static<
  typeof UpdateDatasetSnapshotRequestBodySchema
>;

const Counts = Type.Object({
  patients: Type.Integer(),
  images: Type.Integer(),
  normal: Type.Integer(),
  abnormal: Type.Integer(),
  bySource: Type.Record(Type.String(), Type.Integer()),
});

export const DatasetSplitSummarySchema = Type.Object({
  TRAIN: Counts,
  VALIDATION: Counts,
  TEST: Counts,
});

export type DatasetSplitSummary = Static<typeof DatasetSplitSummarySchema>;

export const DatasetSnapshotSummarySchema = Type.Object({
  id: IDSchema,
  name: Type.String(),
  description: Nullable(Type.String()),
  status: Type.Enum(DatasetSnapshotStatus),
  datasetSchemaVersion: Type.Integer(),
  configuration: DatasetSnapshotConfigV1Schema,
  createdByName: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
  finalizedAt: Nullable(Type.String({ format: 'date-time' })),
  finalizedByName: Nullable(Type.String()),
  archivedAt: Nullable(Type.String({ format: 'date-time' })),
  archivedByName: Nullable(Type.String()),
  reviewFreezeId: Nullable(IDSchema),
  fileVerification: Nullable(Type.String()),
  totalPatients: Nullable(Type.Integer()),
  totalImages: Nullable(Type.Integer()),
  normalImages: Nullable(Type.Integer()),
  abnormalImages: Nullable(Type.Integer()),
  excludedImages: Nullable(Type.Integer()),
  exclusionSummary: Nullable(Type.Record(Type.String(), Type.Integer())),
  /** Finalized snapshots only (from the stored membership). */
  splits: Nullable(DatasetSplitSummarySchema),
});

export type DatasetSnapshotSummary = Static<typeof DatasetSnapshotSummarySchema>;

export const DatasetSnapshotListResponseSchema = Type.Array(DatasetSnapshotSummarySchema);

export type DatasetSnapshotListResponse = Static<typeof DatasetSnapshotListResponseSchema>;

export const DatasetSnapshotPreviewSchema = Type.Object({
  snapshotId: IDSchema,
  /** A preview is never finalized: review may still change without a freeze. */
  reviewFrozen: Type.Boolean(),
  /** Cheap checks only (hash present, file exists, size); finalization re-hashes. */
  fileVerification: Type.Literal('EXISTS_AND_SIZE'),
  configuration: DatasetSnapshotConfigV1Schema,
  eligiblePatients: Type.Integer(),
  eligibleImages: Type.Integer(),
  labels: Type.Object({ NORMAL: Type.Integer(), ABNORMAL: Type.Integer() }),
  bySource: Type.Record(Type.String(), Type.Integer()),
  excluded: Type.Object({
    total: Type.Integer(),
    byReason: Type.Record(Type.String(), Type.Integer()),
  }),
  strata: Type.Record(Type.String(), Type.Integer()),
  /** Global patient capacity per split. */
  quotas: Nullable(Type.Record(Type.String(), Type.Integer())),
  splits: Nullable(DatasetSplitSummarySchema),
  /** Why no split could be planned (e.g. INSUFFICIENT_PATIENTS). */
  splitError: Nullable(Type.Object({ code: Type.String(), message: Type.String() })),
});

export type DatasetSnapshotPreview = Static<typeof DatasetSnapshotPreviewSchema>;

export const DatasetSnapshotItemSchema = Type.Object({
  patientImageId: IDSchema,
  seriesId: IDSchema,
  studyId: IDSchema,
  patientId: IDSchema,
  patientGroupKey: Type.String(),
  split: Type.Enum(DatasetSplit),
  label: Type.Enum(DatasetLabel),
  reviewStateAtSnapshot: Type.String(),
  reviewStateSourceAtSnapshot: Type.Enum(DatasetReviewSource),
  reviewResolutionId: Nullable(IDSchema),
  reviewCompletionId: Nullable(IDSchema),
  normalVotes: Type.Integer(),
  abnormalVotes: Type.Integer(),
  uncertainVotes: Type.Integer(),
  seriesOrderIndex: Type.Integer(),
  /** Verified at finalization: a consumer must re-check the bytes against it. */
  fileSha256: Type.String(),
  fileSize: Type.Integer(),
});

export type DatasetSnapshotItem = Static<typeof DatasetSnapshotItemSchema>;

export const DatasetSnapshotItemsQuerySchema = Type.Object({
  split: Type.Optional(Type.Enum(DatasetSplit)),
  /** The last patientImageId of the previous page. */
  after: Type.Optional(Type.String()),
  limit: Type.Optional(Type.String()),
});

export type DatasetSnapshotItemsQuery = Static<typeof DatasetSnapshotItemsQuerySchema>;

export const DatasetSnapshotItemsResponseSchema = Type.Object({
  items: Type.Array(DatasetSnapshotItemSchema),
  /** Pass as `after` for the next page; null on the last page. */
  next: Nullable(Type.String()),
});

export type DatasetSnapshotItemsResponse = Static<typeof DatasetSnapshotItemsResponseSchema>;

export const DatasetSnapshotParamsSchema = Type.Object({ id: Type.String() });
