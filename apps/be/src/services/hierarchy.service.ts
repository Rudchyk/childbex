/**
 * Patient -> Study -> Series -> PatientImage navigation (read-only).
 *
 * - Every lookup checks the whole chain Series -> Study -> Patient (patient
 *   not in the trash) in the query itself; anything else is "not found",
 *   the same as an unknown id.
 * - Review summaries are counted in SQL (one grouped query per list) from
 *   `reviewState`; broken images are counted separately, never as a state.
 * - No DICOM UIDs, file hashes, stored paths or file names are returned.
 */
import { QueryTypes, type Transaction } from 'sequelize';
import { apiRoutes } from '@libs/constants';
import type {
  PatientSeriesResponse,
  PatientStudiesResponse,
  ReviewSummary,
  SeriesImage,
  SeriesSummary,
  StudySeriesResponse,
  StudySummary,
} from '@libs/schemas';
import { sequelize } from '../db/sequelize';
import { PatientImageReviewVote } from '../db/models/PatientImageReviewVote.model';
import {
  isSimpleStack,
  orderSeriesImages,
  type StackImage,
} from './series-stack';
import {
  findImplicitNormals,
  findLatestSeriesCompletions,
  imageSetRevision,
} from './series-review';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Ownership -----------------------------------------------------------------

const activePatientExists = async (patientId: string) =>
  UUID.test(patientId) &&
  !!(
    await sequelize.query(
      'SELECT 1 FROM patients WHERE id = :patientId AND "deletedAt" IS NULL',
      { replacements: { patientId }, type: QueryTypes.SELECT }
    )
  ).length;

const ownedStudyExists = async (patientId: string, studyId: string) =>
  UUID.test(patientId) &&
  UUID.test(studyId) &&
  !!(
    await sequelize.query(
      `SELECT 1 FROM studies s
       JOIN patients p ON p.id = s."patientId" AND p."deletedAt" IS NULL
       WHERE s.id = :studyId AND p.id = :patientId`,
      { replacements: { patientId, studyId }, type: QueryTypes.SELECT }
    )
  ).length;

/** The Series if it belongs to a Study of this (active) patient, else null. */
export const findOwnedSeries = async (
  patientId: string,
  seriesId: string,
  transaction?: Transaction
) => {
  if (!UUID.test(patientId) || !UUID.test(seriesId)) return null;
  const [row] = await sequelize.query<{
    id: string;
    studyId: string;
    patientSlug: string;
    studyDate: string | null;
    studyTime: string | null;
  }>(
    `SELECT se.id, se."studyId", p.slug AS "patientSlug",
            s."studyDate"::text AS "studyDate", s."studyTime"
     FROM series se
     JOIN studies s ON s.id = se."studyId"
     JOIN patients p ON p.id = s."patientId" AND p."deletedAt" IS NULL
     WHERE se.id = :seriesId AND p.id = :patientId`,
    { replacements: { patientId, seriesId }, type: QueryTypes.SELECT, transaction }
  );
  return row ?? null;
};

// --- Images of a Series (ordering input) ----------------------------------------

export interface StackImageRow {
  id: string;
  isBrocken: boolean;
  instanceNumber: number | null;
  imageOrientationPatient: number[] | null;
  imagePositionPatient: number[] | null;
  numberOfFrames: number | null;
  rows: number | null;
  columns: number | null;
  pixelSpacing: number[] | null;
}

export const stackImageColumns = `id, "isBrocken", "instanceNumber",
  "imageOrientationPatient", "imagePositionPatient", "numberOfFrames",
  rows, columns, "pixelSpacing"`;

export const toStackImage = <T extends StackImageRow>(
  row: T
): T & StackImage => ({ ...row, isBroken: row.isBrocken });

// --- Summaries -----------------------------------------------------------------

const summaryColumns = `
  count(i.id)::int AS total,
  count(i.id) FILTER (WHERE i."isBrocken")::int AS broken,
  count(i.id) FILTER (WHERE NOT i."isBrocken" AND i."reviewState" = 'NOT_REVIEWED')::int AS "notReviewed",
  count(i.id) FILTER (WHERE NOT i."isBrocken" AND i."reviewState" = 'NORMAL')::int AS normal,
  count(i.id) FILTER (WHERE NOT i."isBrocken" AND i."reviewState" = 'ABNORMAL')::int AS abnormal,
  count(i.id) FILTER (WHERE NOT i."isBrocken" AND i."reviewState" = 'UNCERTAIN')::int AS uncertain,
  count(i.id) FILTER (WHERE NOT i."isBrocken" AND i."reviewState" = 'CONFLICTED')::int AS conflicted`;

type SummaryRow = ReviewSummary;

const toReviewSummary = (row: SummaryRow): ReviewSummary => ({
  total: row.total,
  broken: row.broken,
  notReviewed: row.notReviewed,
  normal: row.normal,
  abnormal: row.abnormal,
  uncertain: row.uncertain,
  conflicted: row.conflicted,
});

const studySummaries = async (
  patientId: string,
  studyId?: string
): Promise<StudySummary[]> => {
  const rows = await sequelize.query<
    SummaryRow & {
      id: string;
      studyDate: string | null;
      studyTime: string | null;
      seriesCount: number;
    }
  >(
    `SELECT s.id, s."studyDate"::text AS "studyDate", s."studyTime",
            count(DISTINCT se.id)::int AS "seriesCount", ${summaryColumns}
     FROM studies s
     LEFT JOIN series se ON se."studyId" = s.id
     LEFT JOIN patients_images i ON i."seriesId" = se.id
     WHERE s."patientId" = :patientId ${studyId ? 'AND s.id = :studyId' : ''}
     GROUP BY s.id
     ORDER BY s."studyDate" ASC NULLS LAST, s."studyTime" ASC NULLS LAST, s.id`,
    { replacements: { patientId, studyId }, type: QueryTypes.SELECT }
  );
  return rows.map((row) => ({
    id: row.id,
    studyDate: row.studyDate,
    studyTime: row.studyTime,
    seriesCount: row.seriesCount,
    imageCount: row.total,
    review: toReviewSummary(row),
  }));
};

const seriesSummaries = async (
  studyId: string,
  seriesId?: string
): Promise<SeriesSummary[]> => {
  const rows = await sequelize.query<
    SummaryRow & {
      id: string;
      studyId: string;
      seriesNumber: number | null;
      seriesDescription: string | null;
      modality: string | null;
      imageType: string[] | null;
      convolutionKernel: string | null;
      sliceThickness: number | null;
    }
  >(
    `SELECT se.id, se."studyId", se."seriesNumber", se."seriesDescription",
            se.modality, se."imageType", se."convolutionKernel",
            se."sliceThickness", ${summaryColumns}
     FROM series se
     LEFT JOIN patients_images i ON i."seriesId" = se.id
     WHERE se."studyId" = :studyId ${seriesId ? 'AND se.id = :seriesId' : ''}
     GROUP BY se.id
     ORDER BY se."seriesNumber" ASC NULLS LAST, se.id`,
    { replacements: { studyId, seriesId }, type: QueryTypes.SELECT }
  );
  if (!rows.length) return [];

  // Orientation / multi-frame structure: one query for all these series.
  const images = await sequelize.query<StackImageRow & { seriesId: string }>(
    `SELECT "seriesId", ${stackImageColumns} FROM patients_images
     WHERE "seriesId" IN (:ids)`,
    {
      replacements: { ids: rows.map(({ id }) => id) },
      type: QueryTypes.SELECT,
    }
  );
  const bySeries = new Map<string, StackImage[]>();
  for (const image of images) {
    bySeries.set(image.seriesId, [
      ...(bySeries.get(image.seriesId) ?? []),
      toStackImage(image),
    ]);
  }

  return rows.map((row) => {
    const stack = orderSeriesImages(bySeries.get(row.id) ?? []);
    return {
      id: row.id,
      studyId: row.studyId,
      seriesNumber: row.seriesNumber,
      seriesDescription: row.seriesDescription,
      modality: row.modality,
      imageType: row.imageType,
      convolutionKernel: row.convolutionKernel,
      sliceThickness: row.sliceThickness,
      imageCount: row.total,
      review: toReviewSummary(row),
      orientationCount: stack.orientationCount,
      multiFrameImageCount: stack.multiFrameImageCount,
      geometryCount: stack.geometryCount,
      geometryIncompleteCount: stack.geometryIncompleteCount,
      // The same rule as Series Finish review (review.service.ts).
      reviewable: isSimpleStack(stack),
    };
  });
};

// --- API reads ---------------------------------------------------------------------

/**
 * Stored file locations of images of a Series of the (active) patient, in
 * the order of `imageIds`; null when the Series is not the patient's or
 * any image is not in it (the caller cannot tell which).
 */
export const findSeriesImageSources = async (
  patientId: string,
  seriesId: string,
  imageIds: readonly string[]
): Promise<string[] | null> => {
  const ids = [...new Set(imageIds)];
  if (!ids.length || !ids.every((id) => UUID.test(id))) return null;
  if (!(await findOwnedSeries(patientId, seriesId))) return null;
  const rows = await sequelize.query<{ id: string; source: string }>(
    `SELECT id, source FROM patients_images
     WHERE "seriesId" = :seriesId AND id IN (:ids)`,
    { replacements: { seriesId, ids }, type: QueryTypes.SELECT }
  );
  if (rows.length !== ids.length) return null;
  const sources = new Map(rows.map(({ id, source }) => [id, source]));
  return ids.map((id) => sources.get(id) as string);
};

/** Study and image counts per patient (one grouped query). */
export const countPatientImages = async (patientIds: readonly string[]) => {
  const counts = new Map<string, { studyCount: number; imageCount: number }>();
  if (!patientIds.length) return counts;
  const rows = await sequelize.query<{
    patientId: string;
    studyCount: number;
    imageCount: number;
  }>(
    `SELECT s."patientId", count(DISTINCT s.id)::int AS "studyCount",
            count(i.id)::int AS "imageCount"
     FROM studies s
     LEFT JOIN series se ON se."studyId" = s.id
     LEFT JOIN patients_images i ON i."seriesId" = se.id
     WHERE s."patientId" IN (:patientIds)
     GROUP BY s."patientId"`,
    { replacements: { patientIds: [...patientIds] }, type: QueryTypes.SELECT }
  );
  for (const { patientId, ...row } of rows) counts.set(patientId, row);
  return counts;
};

/** Studies of an active patient, or null (unknown or trashed patient). */
export const getPatientStudies = async (
  patientId: string
): Promise<PatientStudiesResponse | null> => {
  if (!(await activePatientExists(patientId))) return null;
  // Every image belongs to a Series (migration 202610010000): none is left out.
  return { patientId, studies: await studySummaries(patientId) };
};

/** Series of a Study of the patient, or null (not the patient's study). */
export const getStudySeries = async (
  patientId: string,
  studyId: string
): Promise<StudySeriesResponse | null> => {
  if (!(await ownedStudyExists(patientId, studyId))) return null;
  const [study] = await studySummaries(patientId, studyId);
  return { study, series: await seriesSummaries(studyId) };
};

const fileUrl = (patientId: string, imageId: string) =>
  apiRoutes.patientImageFile
    .replace(':id', patientId)
    .replace(':imageId', imageId);

interface SeriesImageRow extends StackImageRow {
  notes: string | null;
  reviewState: SeriesImage['reviewState'];
  reviewStateSource: SeriesImage['reviewStateSource'];
  status: SeriesImage['status'];
  isAbnormal: boolean;
  votesCount: number;
  normalVotes: number;
  abnormalVotes: number;
  uncertainVotes: number;
  adminResolutionId: string | null;
  adminResolutionName: string | null;
  resolutionComment: string | null;
  resolvedAt: Date | null;
}

/** A Series of the patient with its images in display order, or null. */
export const getPatientSeries = async (
  patientId: string,
  seriesId: string
): Promise<PatientSeriesResponse | null> => {
  const owned = await findOwnedSeries(patientId, seriesId);
  if (!owned) return null;
  const [series] = await seriesSummaries(owned.studyId, seriesId);
  const rows = await sequelize.query<SeriesImageRow>(
    `SELECT ${stackImageColumns}, notes, "reviewState", "reviewStateSource",
            status::text AS status, "isAbnormal", "votesCount", "normalVotes",
            "abnormalVotes", "uncertainVotes", "adminResolutionId",
            "adminResolutionName", "resolutionComment", "resolvedAt"
     FROM patients_images WHERE "seriesId" = :seriesId`,
    { replacements: { seriesId }, type: QueryTypes.SELECT }
  );
  const votes = rows.length
    ? await PatientImageReviewVote.findAll({
        where: { patientImageId: rows.map(({ id }) => id) },
        order: [
          ['createdAt', 'ASC'],
          ['id', 'ASC'],
        ],
      })
    : [];
  const votesByImage = new Map<string, SeriesImage['votes']>();
  for (const vote of votes) {
    const json = vote.toJSON() as unknown as SeriesImage['votes'][number];
    votesByImage.set(vote.patientImageId, [
      ...(votesByImage.get(vote.patientImageId) ?? []),
      json,
    ]);
  }

  const implicitNormals = await findImplicitNormals(rows.map(({ id }) => id));

  const stack = orderSeriesImages(rows.map(toStackImage));
  const images: SeriesImage[] = stack.images.map(({ image, orientationGroup }) => ({
    id: image.id,
    fileUrl: fileUrl(patientId, image.id),
    instanceNumber: image.instanceNumber,
    orientationGroup,
    isBroken: image.isBrocken,
    // For broken images `notes` holds the import's reason code.
    brokenReason: image.isBrocken ? image.notes : null,
    reviewState: image.reviewState,
    reviewStateSource: image.reviewStateSource,
    status: image.status,
    isAbnormal: image.isAbnormal,
    votesCount: image.votesCount,
    normalVotes: image.normalVotes,
    abnormalVotes: image.abnormalVotes,
    uncertainVotes: image.uncertainVotes,
    adminResolutionId: image.adminResolutionId,
    adminResolutionName: image.adminResolutionName,
    resolutionComment: image.resolutionComment,
    resolvedAt: image.resolvedAt ? new Date(image.resolvedAt).toISOString() : null,
    votes: votesByImage.get(image.id) ?? [],
    implicitNormals: (implicitNormals.get(image.id) ?? []).map((implicit) => ({
      ...implicit,
      completedAt: new Date(implicit.completedAt).toISOString(),
    })),
  }));

  // Per-reviewer completion state of the current (non-broken) image set.
  const current = rows.filter((row) => !row.isBrocken).map(({ id }) => id);
  const revision = imageSetRevision(current);
  const completions = (await findLatestSeriesCompletions(seriesId)).map(
    ({ imageIds, imageSetHash, completedAt, ...completion }) => {
      const covered = new Set(imageIds);
      return {
        ...completion,
        completedAt: new Date(completedAt).toISOString(),
        imageSetRevision: imageSetHash,
        current: imageSetHash === revision,
        uncoveredImageCount: current.filter((id) => !covered.has(id)).length,
      };
    }
  );

  return {
    patient: { id: patientId, slug: owned.patientSlug },
    study: {
      id: owned.studyId,
      studyDate: owned.studyDate,
      studyTime: owned.studyTime,
    },
    series,
    images,
    review: { imageSetRevision: revision, completions },
  };
};
