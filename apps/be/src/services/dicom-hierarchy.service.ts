/**
 * DICOM hierarchy Patient -> Study -> Series (shared by the archive import
 * and `backfill study-series`).
 *
 * - Identity is the UID only (globally unique in `studies` / `series`).
 * - Rows are created with `INSERT ... ON CONFLICT DO NOTHING` and then read
 *   back: a concurrent transaction creating the same UID makes the insert
 *   wait for it, so there are never two rows for one UID and no race.
 * - A UID owned by another patient (study) or study (series) is a conflict:
 *   nothing is re-parented, the caller rolls back.
 * - Descriptive fields are only set while NULL, and only to a value all the
 *   given images agree on; differing values are reported, never overwritten.
 * - UIDs are processed in sorted order, so concurrent transactions lock rows
 *   in the same order (no deadlocks).
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';

export type HierarchyConflictCode =
  | 'STUDY_BELONGS_TO_ANOTHER_PATIENT'
  | 'SERIES_BELONGS_TO_ANOTHER_STUDY';

export class HierarchyConflictError extends Error {
  constructor(readonly code: HierarchyConflictCode) {
    super(
      code === 'STUDY_BELONGS_TO_ANOTHER_PATIENT'
        ? 'A study in this archive is already stored for another patient.'
        : 'A series in this archive already belongs to another study.'
    );
    this.name = 'HierarchyConflictError';
  }
}

export const seriesFieldNames = [
  'seriesNumber',
  'seriesDescription',
  'modality',
  'imageType',
  'frameOfReferenceUid',
  'convolutionKernel',
  'sliceThickness',
] as const;

export type SeriesField = (typeof seriesFieldNames)[number];

export interface SeriesFields {
  seriesNumber: number | null;
  /** Free text: never log it. */
  seriesDescription: string | null;
  modality: string | null;
  imageType: string[] | null;
  frameOfReferenceUid: string | null;
  convolutionKernel: string | null;
  sliceThickness: number | null;
}

export interface StudyFields {
  /** `YYYY-MM-DD` */
  studyDate: string | null;
  studyTime: string | null;
}

const fieldTypes: Record<SeriesField | keyof StudyFields, string> = {
  seriesNumber: 'integer',
  seriesDescription: 'text',
  modality: 'varchar(16)',
  imageType: 'text[]',
  frameOfReferenceUid: 'varchar(64)',
  convolutionKernel: 'text',
  sliceThickness: 'double precision',
  studyDate: 'date',
  studyTime: 'varchar(16)',
};

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, i) => sameValue(item, b[i]))
    : a === b;

/**
 * Per field: the value all sources agree on. Missing (null) values are
 * ignored; differing values give `null` and are listed in `disagreements`.
 */
export const agreeOn = <K extends string>(
  sources: Partial<Record<K, unknown>>[],
  fields: readonly K[]
): { values: Record<K, unknown>; disagreements: K[] } => {
  const values = {} as Record<K, unknown>;
  const disagreements: K[] = [];
  for (const field of fields) {
    const present = sources
      .map((source) => source[field] ?? null)
      .filter((value) => value !== null);
    const differs = present.some((value) => !sameValue(value, present[0]));
    values[field] = present.length && !differs ? present[0] : null;
    if (differs) disagreements.push(field);
  }
  return { values, disagreements };
};

interface EnsureResult {
  id: string;
  created: boolean;
  /** Fields whose stored value differs from the given one (not changed). */
  inconsistent: string[];
}

/** Fills NULL columns of an existing row; reports differing values. */
const fillNullFields = async (
  sequelize: Sequelize,
  table: 'studies' | 'series',
  id: string,
  storedRow: object,
  given: object,
  transaction: Transaction
) => {
  const stored = storedRow as Record<string, unknown>;
  const bind: unknown[] = [];
  const assignments: string[] = [];
  const inconsistent: string[] = [];
  for (const [field, value] of Object.entries(given)) {
    if (value === null) continue;
    if (stored[field] === null) {
      bind.push(value);
      assignments.push(
        `"${field}" = COALESCE("${field}", $${bind.length}::${
          fieldTypes[field as keyof typeof fieldTypes]
        })`
      );
    } else if (!sameValue(stored[field], value)) {
      inconsistent.push(field);
    }
  }
  if (assignments.length) {
    bind.push(id);
    await sequelize.query(
      `UPDATE ${table} SET ${assignments.join(', ')}, "updatedAt" = now()
       WHERE id = $${bind.length}::uuid`,
      { bind, transaction }
    );
  }
  return inconsistent;
};

export const ensureStudy = async (
  sequelize: Sequelize,
  input: { patientId: string; studyInstanceUid: string } & StudyFields,
  transaction: Transaction
): Promise<EnsureResult> => {
  const inserted = await sequelize.query<{ id: string }>(
    `INSERT INTO studies (id, "patientId", "studyInstanceUid", "studyDate",
       "studyTime", "createdAt", "updatedAt")
     VALUES ($1::uuid, $2::uuid, $3, $4::date, $5, now(), now())
     ON CONFLICT ("studyInstanceUid") DO NOTHING
     RETURNING id`,
    {
      bind: [
        randomUUID(),
        input.patientId,
        input.studyInstanceUid,
        input.studyDate,
        input.studyTime,
      ],
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  const [study] = await sequelize.query<
    { id: string; patientId: string } & StudyFields
  >(
    `SELECT id, "patientId", "studyDate"::text AS "studyDate", "studyTime"
     FROM studies WHERE "studyInstanceUid" = $1`,
    { bind: [input.studyInstanceUid], type: QueryTypes.SELECT, transaction }
  );
  if (study.patientId !== input.patientId) {
    throw new HierarchyConflictError('STUDY_BELONGS_TO_ANOTHER_PATIENT');
  }
  const created = inserted.length > 0;
  const inconsistent = created
    ? []
    : await fillNullFields(
        sequelize,
        'studies',
        study.id,
        study,
        { studyDate: input.studyDate, studyTime: input.studyTime },
        transaction
      );
  return { id: study.id, created, inconsistent };
};

export const ensureSeries = async (
  sequelize: Sequelize,
  input: { studyId: string; seriesInstanceUid: string } & SeriesFields,
  transaction: Transaction
): Promise<EnsureResult> => {
  const fields = Object.fromEntries(
    seriesFieldNames.map((field) => [field, input[field]])
  ) as unknown as SeriesFields;
  const inserted = await sequelize.query<{ id: string }>(
    `INSERT INTO series (id, "studyId", "seriesInstanceUid", "seriesNumber",
       "seriesDescription", modality, "imageType", "frameOfReferenceUid",
       "convolutionKernel", "sliceThickness", "createdAt", "updatedAt")
     VALUES ($1::uuid, $2::uuid, $3, $4::integer, $5, $6, $7::text[], $8, $9,
       $10::double precision, now(), now())
     ON CONFLICT ("seriesInstanceUid") DO NOTHING
     RETURNING id`,
    {
      bind: [
        randomUUID(),
        input.studyId,
        input.seriesInstanceUid,
        fields.seriesNumber,
        fields.seriesDescription,
        fields.modality,
        fields.imageType,
        fields.frameOfReferenceUid,
        fields.convolutionKernel,
        fields.sliceThickness,
      ],
      type: QueryTypes.SELECT,
      transaction,
    }
  );
  const [series] = await sequelize.query<
    { id: string; studyId: string } & SeriesFields
  >(
    `SELECT id, "studyId", ${seriesFieldNames.map((f) => `"${f}"`).join(', ')}
     FROM series WHERE "seriesInstanceUid" = $1`,
    { bind: [input.seriesInstanceUid], type: QueryTypes.SELECT, transaction }
  );
  if (series.studyId !== input.studyId) {
    throw new HierarchyConflictError('SERIES_BELONGS_TO_ANOTHER_STUDY');
  }
  const created = inserted.length > 0;
  const inconsistent = created
    ? []
    : await fillNullFields(
        sequelize,
        'series',
        series.id,
        series,
        fields,
        transaction
      );
  return { id: series.id, created, inconsistent };
};

/** What the hierarchy needs to know about one image. */
export interface HierarchyImage extends Partial<SeriesFields>, Partial<StudyFields> {
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
}

export interface HierarchyWarning {
  kind: 'study' | 'series';
  id: string;
  /** Field names only (never values). */
  disagreeingImages: string[];
  differsFromStored: string[];
}

export interface LinkedHierarchy {
  /** seriesInstanceUid -> series id */
  seriesIds: Map<string, string>;
  studiesCreated: number;
  seriesCreated: number;
  warnings: HierarchyWarning[];
}

const byUid = <T>(entries: Map<string, T>) =>
  [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Creates or reuses the studies and series of one patient's images (those
 * with both UIDs) inside `transaction`. Throws `HierarchyConflictError`.
 */
export const linkPatientHierarchy = async (
  sequelize: Sequelize,
  patientId: string,
  images: HierarchyImage[],
  transaction: Transaction
): Promise<LinkedHierarchy> => {
  const studies = new Map<string, Map<string, HierarchyImage[]>>();
  for (const image of images) {
    const { studyInstanceUid: study, seriesInstanceUid: series } = image;
    if (!study || !series) continue;
    const seriesOfStudy = studies.get(study) ?? new Map();
    studies.set(study, seriesOfStudy);
    seriesOfStudy.set(series, [...(seriesOfStudy.get(series) ?? []), image]);
  }

  const result: LinkedHierarchy = {
    seriesIds: new Map(),
    studiesCreated: 0,
    seriesCreated: 0,
    warnings: [],
  };
  for (const [studyInstanceUid, seriesOfStudy] of byUid(studies)) {
    const studyImages = [...seriesOfStudy.values()].flat();
    const studyAgreement = agreeOn(studyImages, ['studyDate', 'studyTime']);
    const study = await ensureStudy(
      sequelize,
      {
        patientId,
        studyInstanceUid,
        ...(studyAgreement.values as unknown as StudyFields),
      },
      transaction
    );
    if (study.created) result.studiesCreated += 1;
    if (study.inconsistent.length || studyAgreement.disagreements.length) {
      result.warnings.push({
        kind: 'study',
        id: study.id,
        disagreeingImages: studyAgreement.disagreements,
        differsFromStored: study.inconsistent,
      });
    }

    for (const [seriesInstanceUid, seriesImages] of byUid(seriesOfStudy)) {
      const agreement = agreeOn(seriesImages, seriesFieldNames);
      const series = await ensureSeries(
        sequelize,
        {
          studyId: study.id,
          seriesInstanceUid,
          ...(agreement.values as unknown as SeriesFields),
        },
        transaction
      );
      if (series.created) result.seriesCreated += 1;
      result.seriesIds.set(seriesInstanceUid, series.id);
      if (series.inconsistent.length || agreement.disagreements.length) {
        result.warnings.push({
          kind: 'series',
          id: series.id,
          disagreeingImages: agreement.disagreements,
          differsFromStored: series.inconsistent,
        });
      }
    }
  }
  return result;
};
