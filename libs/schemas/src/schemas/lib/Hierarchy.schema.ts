import { Type, type Static } from '@sinclair/typebox';
import { IDSchema } from './ID.schema.js';
import { Nullable } from '../../utils/typebox-helpers.js';
import {
  PatientImageSchema,
  ReviewState,
  ReviewStateSource,
} from './PatientImage.schema.js';
import { PatientImageReviewVoteSchema } from './PatientImageReviewVote.schema.js';

/**
 * Patient -> Study -> Series navigation. No DICOM UIDs, file hashes,
 * stored paths or file names.
 */

/** Review progress; state counts are of non-broken images only. */
export const ReviewSummarySchema = Type.Object({
  /** All images (broken included): broken + the five state counts. */
  total: Type.Integer(),
  broken: Type.Integer(),
  notReviewed: Type.Integer(),
  normal: Type.Integer(),
  abnormal: Type.Integer(),
  uncertain: Type.Integer(),
  conflicted: Type.Integer(),
});

export type ReviewSummary = Static<typeof ReviewSummarySchema>;

export const StudySummarySchema = Type.Object({
  id: IDSchema,
  /** DICOM StudyDate as YYYY-MM-DD. */
  studyDate: Nullable(Type.String()),
  /** DICOM StudyTime (HHMMSS[.ffffff]). */
  studyTime: Nullable(Type.String()),
  seriesCount: Type.Integer(),
  imageCount: Type.Integer(),
  review: ReviewSummarySchema,
});

export type StudySummary = Static<typeof StudySummarySchema>;

export const SeriesSummarySchema = Type.Object({
  id: IDSchema,
  studyId: IDSchema,
  seriesNumber: Nullable(Type.Integer()),
  seriesDescription: Nullable(Type.String()),
  modality: Nullable(Type.String()),
  imageType: Nullable(Type.Array(Type.String())),
  convolutionKernel: Nullable(Type.String()),
  sliceThickness: Nullable(Type.Number()),
  imageCount: Type.Integer(),
  review: ReviewSummarySchema,
  /** Orientation groups among the non-broken images. */
  orientationCount: Type.Integer(),
  /** Non-broken images with more than one frame. */
  multiFrameImageCount: Type.Integer(),
  /** Distinct (rows, columns, pixel spacing) among the non-broken images. */
  geometryCount: Type.Integer(),
  /** Non-broken images without complete geometry. */
  geometryIncompleteCount: Type.Integer(),
  /**
   * Server-derived: the viewer shows the whole Series (one orientation, one
   * geometry, complete geometry, no multi-frame image), so it can be viewed
   * and finished as a whole. The GUI and Finish review use this rule.
   */
  reviewable: Type.Boolean(),
});

export type SeriesSummary = Static<typeof SeriesSummarySchema>;

const image = PatientImageSchema.properties;

export const SeriesImageSchema = Type.Object({
  id: IDSchema,
  /** Authenticated file route, relative to the API base (`/api/v1`). */
  fileUrl: Type.String(),
  instanceNumber: Nullable(Type.Integer()),
  /** Orientation group within the series; null for broken images. */
  orientationGroup: Nullable(Type.Integer()),
  isBroken: Type.Boolean(),
  /** Import reason code, broken images only. */
  brokenReason: Nullable(Type.String()),
  reviewState: Type.Enum(ReviewState),
  reviewStateSource: Type.Enum(ReviewStateSource),
  // Compatibility caches (the review panel still shows them).
  status: image.status,
  isAbnormal: image.isAbnormal,
  votesCount: image.votesCount,
  normalVotes: image.normalVotes,
  abnormalVotes: image.abnormalVotes,
  uncertainVotes: image.uncertainVotes,
  adminResolutionId: image.adminResolutionId,
  adminResolutionName: image.adminResolutionName,
  resolutionComment: image.resolutionComment,
  resolvedAt: Nullable(Type.String({ format: 'date-time' })),
  votes: Type.Array(PatientImageReviewVoteSchema),
});

export type SeriesImage = Static<typeof SeriesImageSchema>;

export const PatientStudiesResponseSchema = Type.Object({
  patientId: IDSchema,
  studies: Type.Array(StudySummarySchema),
});

export type PatientStudiesResponse = Static<typeof PatientStudiesResponseSchema>;

export const StudySeriesResponseSchema = Type.Object({
  study: StudySummarySchema,
  series: Type.Array(SeriesSummarySchema),
});

export type StudySeriesResponse = Static<typeof StudySeriesResponseSchema>;

export const PatientSeriesResponseSchema = Type.Object({
  patient: Type.Object({ id: IDSchema, slug: Type.String() }),
  study: Type.Object({
    id: IDSchema,
    studyDate: Nullable(Type.String()),
    studyTime: Nullable(Type.String()),
  }),
  series: SeriesSummarySchema,
  /** Display order (see the series ordering rule); broken images last. */
  images: Type.Array(SeriesImageSchema),
});

export type PatientSeriesResponse = Static<typeof PatientSeriesResponseSchema>;

export const PatientStudiesParamsSchema = Type.Object({
  patientId: Type.String(),
});

export type PatientStudiesParams = Static<typeof PatientStudiesParamsSchema>;

export const PatientStudyParamsSchema = Type.Object({
  patientId: Type.String(),
  studyId: Type.String(),
});

export type PatientStudyParams = Static<typeof PatientStudyParamsSchema>;

export const PatientSeriesParamsSchema = Type.Object({
  patientId: Type.String(),
  seriesId: Type.String(),
});

export type PatientSeriesParams = Static<typeof PatientSeriesParamsSchema>;

export const FinishSeriesReviewRequestBodySchema = Type.Object(
  {
    /**
     * The non-broken images the reviewer was shown; must be exactly the
     * series' non-broken images (else 409 SERIES_CHANGED).
     */
    presentedImageIds: Type.Array(IDSchema, { maxItems: 100000 }),
  },
  { additionalProperties: false }
);

export type FinishSeriesReviewRequestBody = Static<
  typeof FinishSeriesReviewRequestBodySchema
>;
