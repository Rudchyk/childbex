/**
 * Which images a snapshot includes (pure; schema version 1).
 *
 * Included: reviewState NORMAL / ABNORMAL (the authoritative, frozen review
 * result: votes are never re-counted), from an included review source, of
 * a non-trashed patient, not broken, in a fully reviewable Series (the
 * application's `isSimpleStack` rule), with a file that passes the file
 * checks. Every other image is excluded with the FIRST matching reason, in
 * the order of `DatasetExclusionReason`.
 */
import {
  DatasetExclusionReason as Reason,
  DatasetLabel,
  type DatasetReviewSource,
  type DatasetSnapshotConfigV1,
} from '@libs/schemas';

export interface EligibilityInput {
  patientTrashed: boolean;
  isBroken: boolean;
  seriesReviewable: boolean;
  reviewState: string;
  reviewStateSource: string;
  fileSha256: string | null;
}

/** Reasons decided from the database alone (before any file is touched). */
export const dataExclusionReason = (
  image: EligibilityInput,
  config: DatasetSnapshotConfigV1
): Reason | null => {
  if (image.patientTrashed) return Reason.PATIENT_TRASHED;
  if (image.isBroken) return Reason.BROKEN;
  if (!image.seriesReviewable) return Reason.SERIES_NOT_FULLY_REVIEWABLE;
  switch (image.reviewState) {
    case 'NORMAL':
    case 'ABNORMAL':
      break;
    case 'UNCERTAIN':
      return Reason.UNCERTAIN;
    case 'CONFLICTED':
      return Reason.CONFLICTED;
    default:
      return Reason.NOT_REVIEWED;
  }
  if (!config.includeReviewSources.includes(image.reviewStateSource as DatasetReviewSource)) {
    return Reason.REVIEW_SOURCE_NOT_INCLUDED;
  }
  if (!image.fileSha256 || !/^[0-9a-f]{64}$/.test(image.fileSha256)) {
    return Reason.MISSING_FILE_HASH;
  }
  return null;
};

/** The label of an included image: its authoritative review state. */
export const labelOf = (reviewState: string): DatasetLabel =>
  reviewState === 'ABNORMAL' ? DatasetLabel.ABNORMAL : DatasetLabel.NORMAL;

/** The order of the reasons (for deterministic reporting). */
export const exclusionReasonOrder = Object.values(Reason);
