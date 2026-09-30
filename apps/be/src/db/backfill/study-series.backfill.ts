/**
 * Links existing `patients_images` rows to DICOM Study / Series entities
 * (maintenance command, never run on startup; dry-run unless `apply`).
 *
 * - Uses the UIDs already stored on the images. Only rows whose metadata was
 *   read completely and without conflict (`fileSha256 IS NOT NULL`, set by
 *   the import or `backfill dicom-metadata`) are used: the hash is only that
 *   marker, the hierarchy itself depends on the UIDs alone.
 * - A Study UID under several patients, or a Series UID under several
 *   studies (among these rows and the existing studies/series), is a
 *   conflict: none of its images is linked, nothing is re-parented.
 * - StudyDate / StudyTime come from one representative file per study (the
 *   same safe path resolution as the metadata backfill); when unavailable
 *   they stay NULL with a warning, without blocking the linking.
 * - One transaction per study; `updatedAt` and review data are unchanged.
 * - Reports contain ids, codes, counters and keyed HMACs only.
 */
import { stat } from 'node:fs/promises';
import { QueryTypes, type Sequelize } from 'sequelize';
import { parseDicomFile } from '../../services/dicom.service';
import {
  agreeOn,
  ensureSeries,
  ensureStudy,
  HierarchyConflictError,
  seriesFieldNames,
  type SeriesFields,
} from '../../services/dicom-hierarchy.service';
import { resolveStoredFile } from '../../services/stored-file';
import { assertMigratedThrough } from '../migrator';
import {
  BackfillPreconditionError,
  MIN_HMAC_KEY_LENGTH,
  reportKey,
} from './dicom-metadata.backfill';

export interface StudySeriesBackfillOptions {
  apply: boolean;
  /** Also link images of patients in the trash (they are not restored). */
  includeTrashed: boolean;
  uploadRoot: string;
  hmacKey: string;
  onProgress?: (line: string) => void;
}

export type StudySeriesRowResult =
  | 'would_link'
  | 'linked'
  /** No complete metadata read yet: run `backfill dicom-metadata` first. */
  | 'metadata_not_verified'
  | 'missing_study_uid'
  | 'missing_series_uid'
  | 'study_ownership_conflict'
  | 'series_ownership_conflict'
  | 'changed_during_run'
  | 'skipped_trashed_patient';

export interface StudySeriesRowReport {
  imageId: string;
  patientId: string;
  result: StudySeriesRowResult;
}

export interface StudyPlanReport {
  key: string;
  patientId: string;
  /** Set once the study exists (after apply, or when it already existed). */
  studyId: string | null;
  action: 'create' | 'reuse';
  images: number;
  series: number;
  /**
   * `representative_file_unavailable`, `study_date_unavailable`,
   * `study_time_unavailable`, `study_values_differ:<fields>`,
   * `series_values_differ:<series key>:<fields>`.
   */
  warnings: string[];
}

export interface StudySeriesReport {
  run: {
    mode: 'dry-run' | 'apply';
    startedAt: string;
    finishedAt: string;
    options: { includeTrashed: boolean };
  };
  summary: Record<string, number>;
  rows: StudySeriesRowReport[];
  studies: StudyPlanReport[];
  conflicts: {
    studyOwnership: { key: string; patientIds: string[]; imageIds: string[] }[];
    seriesOwnership: { key: string; studyKeys: string[]; imageIds: string[] }[];
  };
}

interface ImageRow extends SeriesFields {
  id: string;
  source: string;
  seriesId: string | null;
  verified: boolean;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  patientId: string;
  trashed: boolean;
}

const addTo = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Checks shared by the maintenance commands that read stored files: report
 * key, upload root, database reachable and migrated through
 * `requiredMigration` (later migrations may still be pending).
 */
export const checkPreconditions = async (
  sequelize: Sequelize,
  options: { hmacKey: string; uploadRoot: string },
  requiredMigration: string
) => {
  if (options.hmacKey.length < MIN_HMAC_KEY_LENGTH) {
    throw new BackfillPreconditionError(
      `REPORT_HMAC_KEY must be set (at least ${MIN_HMAC_KEY_LENGTH} characters).`
    );
  }
  const root = await stat(options.uploadRoot).catch(() => null);
  if (!root?.isDirectory()) {
    throw new BackfillPreconditionError(
      'The upload root (UPLOAD_ROOT) does not exist or is not a directory.'
    );
  }
  await sequelize.authenticate();
  await assertMigratedThrough(sequelize, requiredMigration);
};

/** StudyDate / StudyTime of the study, read from one of its files. */
const readStudyDateTime = async (image: ImageRow, uploadRoot: string) => {
  try {
    const file = await resolveStoredFile(image.source, uploadRoot);
    if (!file.ok) return null;
    const parsed = await parseDicomFile(file.realPath);
    return parsed.meta ? parsed.meta.metadata.fileOnly : null;
  } catch {
    return null;
  }
};

export const runStudySeriesBackfill = async (
  sequelize: Sequelize,
  options: StudySeriesBackfillOptions
): Promise<StudySeriesReport> => {
  const startedAt = new Date().toISOString();
  // The studies / series tables must exist.
  await checkPreconditions(sequelize, options, '202609291200-study-series');
  const progress = options.onProgress ?? (() => undefined);
  const key = (kind: string, value: string) =>
    reportKey(options.hmacKey, kind, value);

  const images = await sequelize.query<ImageRow>(
    `SELECT i.id, i.source, i."seriesId", i."fileSha256" IS NOT NULL AS verified,
            i."studyInstanceUid", i."seriesInstanceUid",
            ${seriesFieldNames.map((f) => `i."${f}"`).join(', ')},
            c."patientId", (p."deletedAt" IS NOT NULL) AS trashed
     FROM patients_images i
     JOIN patient_images_clusters c ON c.id = i."clusterId"
     JOIN patients p ON p.id = c."patientId"
     ORDER BY i.id`,
    { type: QueryTypes.SELECT }
  );
  const existingStudies = await sequelize.query<{
    id: string;
    patientId: string;
    studyInstanceUid: string;
  }>(`SELECT id, "patientId", "studyInstanceUid" FROM studies`, {
    type: QueryTypes.SELECT,
  });
  const existingSeries = await sequelize.query<{
    seriesInstanceUid: string;
    studyInstanceUid: string;
  }>(
    `SELECT s."seriesInstanceUid", st."studyInstanceUid"
     FROM series s JOIN studies st ON st.id = s."studyId"`,
    { type: QueryTypes.SELECT }
  );
  const studyIdOf = new Map(
    existingStudies.map((s) => [s.studyInstanceUid, s.id] as const)
  );

  // Ownership over all verified images (also trashed / already linked ones)
  // and the existing entities.
  const studyPatients = new Map<string, Set<string>>();
  const seriesStudies = new Map<string, Set<string>>();
  const imagesOfStudy = new Map<string, string[]>();
  const imagesOfSeries = new Map<string, string[]>();
  for (const s of existingStudies) {
    addTo(studyPatients, s.studyInstanceUid, s.patientId);
  }
  for (const s of existingSeries) {
    addTo(seriesStudies, s.seriesInstanceUid, s.studyInstanceUid);
  }
  for (const image of images) {
    if (!image.verified || !image.studyInstanceUid || !image.seriesInstanceUid) {
      continue;
    }
    addTo(studyPatients, image.studyInstanceUid, image.patientId);
    addTo(seriesStudies, image.seriesInstanceUid, image.studyInstanceUid);
    imagesOfStudy.set(image.studyInstanceUid, [
      ...(imagesOfStudy.get(image.studyInstanceUid) ?? []),
      image.id,
    ]);
    imagesOfSeries.set(image.seriesInstanceUid, [
      ...(imagesOfSeries.get(image.seriesInstanceUid) ?? []),
      image.id,
    ]);
  }
  const conflictedStudies = new Set(
    [...studyPatients].filter(([, p]) => p.size > 1).map(([uid]) => uid)
  );
  const conflictedSeries = new Set(
    [...seriesStudies].filter(([, s]) => s.size > 1).map(([uid]) => uid)
  );

  // Classify the unlinked images; group the linkable ones by study.
  const rows: StudySeriesRowReport[] = [];
  const rowOf = new Map<string, StudySeriesRowReport>();
  const linkable = new Map<string, ImageRow[]>();
  for (const image of images) {
    if (image.seriesId) continue;
    const report: StudySeriesRowReport = {
      imageId: image.id,
      patientId: image.patientId,
      result: 'would_link',
    };
    rows.push(report);
    rowOf.set(image.id, report);
    const study = image.studyInstanceUid;
    const series = image.seriesInstanceUid;
    if (image.trashed && !options.includeTrashed) {
      report.result = 'skipped_trashed_patient';
    } else if (!study) {
      report.result = 'missing_study_uid';
    } else if (!series) {
      report.result = 'missing_series_uid';
    } else if (!image.verified) {
      report.result = 'metadata_not_verified';
    } else if (conflictedStudies.has(study)) {
      report.result = 'study_ownership_conflict';
    } else if (conflictedSeries.has(series)) {
      report.result = 'series_ownership_conflict';
    } else {
      linkable.set(study, [...(linkable.get(study) ?? []), image]);
    }
  }

  const studies: StudyPlanReport[] = [];
  for (const [studyInstanceUid, studyImages] of [...linkable].sort(([a], [b]) =>
    byString(a, b)
  )) {
    const patientId = studyImages[0].patientId;
    const seriesGroups = new Map<string, ImageRow[]>();
    for (const image of studyImages) {
      const uid = image.seriesInstanceUid as string;
      seriesGroups.set(uid, [...(seriesGroups.get(uid) ?? []), image]);
    }
    const plan: StudyPlanReport = {
      key: key('study', studyInstanceUid),
      patientId,
      studyId: studyIdOf.get(studyInstanceUid) ?? null,
      action: studyIdOf.has(studyInstanceUid) ? 'reuse' : 'create',
      images: studyImages.length,
      series: seriesGroups.size,
      warnings: [],
    };
    studies.push(plan);

    // One representative file (the lowest image id) for date and time.
    const dateTime = await readStudyDateTime(studyImages[0], options.uploadRoot);
    if (!dateTime) plan.warnings.push('representative_file_unavailable');
    else {
      if (!dateTime.studyDate) plan.warnings.push('study_date_unavailable');
      if (!dateTime.studyTime) plan.warnings.push('study_time_unavailable');
    }
    const agreements = [...seriesGroups]
      .sort(([a], [b]) => byString(a, b))
      .map(([uid, seriesImages]) => ({
        uid,
        seriesImages,
        agreement: agreeOn(seriesImages, seriesFieldNames),
      }));
    for (const { uid, agreement } of agreements) {
      if (agreement.disagreements.length) {
        plan.warnings.push(
          `series_values_differ:${key('series', uid)}:${agreement.disagreements.join(',')}`
        );
      }
    }
    if (!options.apply) continue;

    try {
      await sequelize.transaction(async (transaction) => {
        const study = await ensureStudy(
          sequelize,
          {
            patientId,
            studyInstanceUid,
            studyDate: dateTime?.studyDate ?? null,
            studyTime: dateTime?.studyTime ?? null,
          },
          transaction
        );
        plan.studyId = study.id;
        if (study.inconsistent.length) {
          plan.warnings.push(`study_values_differ:${study.inconsistent.join(',')}`);
        }
        for (const { uid, seriesImages, agreement } of agreements) {
          const series = await ensureSeries(
            sequelize,
            {
              studyId: study.id,
              seriesInstanceUid: uid,
              ...(agreement.values as unknown as SeriesFields),
            },
            transaction
          );
          if (series.inconsistent.length) {
            plan.warnings.push(
              `series_values_differ:${key('series', uid)}:${series.inconsistent.join(',')}`
            );
          }
          // Only rows that are still unlinked and still carry these UIDs.
          const linked = await sequelize.query<{ id: string }>(
            `UPDATE patients_images SET "seriesId" = $1::uuid
             WHERE id = ANY($2::uuid[]) AND "seriesId" IS NULL
               AND "studyInstanceUid" = $3 AND "seriesInstanceUid" = $4
             RETURNING id`,
            {
              bind: [
                series.id,
                seriesImages.map(({ id }) => id),
                studyInstanceUid,
                uid,
              ],
              type: QueryTypes.SELECT,
              transaction,
            }
          );
          const done = new Set(linked.map(({ id }) => id));
          for (const { id } of seriesImages) {
            const row = rowOf.get(id) as StudySeriesRowReport;
            row.result = done.has(id) ? 'linked' : 'changed_during_run';
          }
        }
      });
    } catch (error) {
      if (!(error instanceof HierarchyConflictError)) throw error;
      // Created concurrently for another patient / study: nothing written.
      plan.studyId = null;
      for (const { id } of studyImages) {
        (rowOf.get(id) as StudySeriesRowReport).result =
          error.code === 'STUDY_BELONGS_TO_ANOTHER_PATIENT'
            ? 'study_ownership_conflict'
            : 'series_ownership_conflict';
      }
    }
    progress(`study ${studies.length}/${linkable.size}: ${studyImages.length} images`);
  }

  const count = (result: StudySeriesRowResult) =>
    rows.filter((row) => row.result === result).length;
  const conflicts: StudySeriesReport['conflicts'] = {
    studyOwnership: [...conflictedStudies].sort(byString).map((uid) => ({
      key: key('study', uid),
      patientIds: [...(studyPatients.get(uid) ?? [])].sort(),
      imageIds: [...(imagesOfStudy.get(uid) ?? [])].sort(),
    })),
    seriesOwnership: [...conflictedSeries].sort(byString).map((uid) => ({
      key: key('series', uid),
      studyKeys: [...(seriesStudies.get(uid) ?? [])]
        .map((study) => key('study', study))
        .sort(),
      imageIds: [...(imagesOfSeries.get(uid) ?? [])].sort(),
    })),
  };

  return {
    run: {
      mode: options.apply ? 'apply' : 'dry-run',
      startedAt,
      finishedAt: new Date().toISOString(),
      options: { includeTrashed: options.includeTrashed },
    },
    summary: {
      totalImages: images.length,
      alreadyLinked: images.length - rows.length,
      unlinked: rows.length,
      wouldLink: count('would_link'),
      linked: count('linked'),
      metadataNotVerified: count('metadata_not_verified'),
      missingStudyUid: count('missing_study_uid'),
      missingSeriesUid: count('missing_series_uid'),
      studyOwnershipConflict: count('study_ownership_conflict'),
      seriesOwnershipConflict: count('series_ownership_conflict'),
      changedDuringRun: count('changed_during_run'),
      skippedTrashedPatient: count('skipped_trashed_patient'),
      studiesToCreate: studies.filter((s) => s.action === 'create').length,
      studiesToReuse: studies.filter((s) => s.action === 'reuse').length,
      studiesWithWarnings: studies.filter((s) => s.warnings.length).length,
      studyOwnershipConflictGroups: conflicts.studyOwnership.length,
      seriesOwnershipConflictGroups: conflicts.seriesOwnership.length,
    },
    rows,
    studies,
    conflicts,
  };
};
