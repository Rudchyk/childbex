-- Read-only readiness check for the Study/Series viewer (PR6).
-- Counts only: no UIDs, patient identifiers, file names or other PHI.
-- Run it only against a database you are allowed to query, e.g.
--   psql "<connection>" -v ON_ERROR_STOP=1 -f series-readiness.sql
-- It uses the same rules as services/series-stack.ts (non-broken images;
-- slice normals parallel within |dot| >= 1 - 1e-3 of the series' first image
-- by (instanceNumber, id); images without a usable orientation are a
-- separate group).
WITH displayable AS (
  SELECT i."seriesId", i.id, i."instanceNumber", i."numberOfFrames",
         o[1] AS r0, o[2] AS r1, o[3] AS r2, o[4] AS c0, o[5] AS c1, o[6] AS c2,
         coalesce(array_length(o, 1), 0) = 6 AS has_orientation
  FROM patients_images i
  CROSS JOIN LATERAL (SELECT i."imageOrientationPatient" AS o) x
  WHERE i."seriesId" IS NOT NULL AND NOT i."isBrocken"
), normals AS (
  SELECT "seriesId", id, "instanceNumber", "numberOfFrames",
         CASE WHEN has_orientation THEN r1 * c2 - r2 * c1 END AS nx,
         CASE WHEN has_orientation THEN r2 * c0 - r0 * c2 END AS ny,
         CASE WHEN has_orientation THEN r0 * c1 - r1 * c0 END AS nz
  FROM displayable
), oriented AS (
  SELECT "seriesId", id, "instanceNumber", "numberOfFrames",
         CASE WHEN len > 0 THEN nx / len END AS ux,
         CASE WHEN len > 0 THEN ny / len END AS uy,
         CASE WHEN len > 0 THEN nz / len END AS uz
  FROM normals
  CROSS JOIN LATERAL (SELECT sqrt(nx * nx + ny * ny + nz * nz) AS len) l
), reference AS (
  SELECT DISTINCT ON ("seriesId") "seriesId", ux AS rx, uy AS ry, uz AS rz
  FROM oriented
  WHERE ux IS NOT NULL
  ORDER BY "seriesId", "instanceNumber" ASC NULLS LAST, id
), per_series AS (
  SELECT o."seriesId",
         bool_or(o.ux IS NOT NULL
                 AND abs(o.ux * r.rx + o.uy * r.ry + o.uz * r.rz) < 1 - 1e-3) AS non_parallel,
         bool_or(o.ux IS NULL) AS without_orientation,
         bool_or(o.ux IS NOT NULL) AS with_orientation,
         bool_or(coalesce(o."numberOfFrames", 1) > 1) AS multi_frame
  FROM oriented o
  LEFT JOIN reference r USING ("seriesId")
  GROUP BY o."seriesId"
)
SELECT
  (SELECT count(*) FROM series)::int AS "series",
  (SELECT count(*) FROM per_series
    WHERE non_parallel OR (without_orientation AND with_orientation))::int
    AS "seriesWithSeveralOrientations",
  (SELECT count(*) FROM per_series WHERE multi_frame)::int
    AS "seriesWithMultiFrameImages",
  (SELECT count(*) FROM patients_images WHERE "seriesId" IS NULL)::int
    AS "imagesWithoutSeries",
  (SELECT count(*) FROM patients_images
    WHERE "seriesId" IS NULL AND "isBrocken")::int AS "brokenImagesWithoutSeries",
  (SELECT count(*) FROM patients_images
    WHERE "seriesId" IS NOT NULL AND "isBrocken")::int AS "brokenImagesInSeries";
