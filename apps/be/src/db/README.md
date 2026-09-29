# Database

PostgreSQL via Sequelize. The schema is managed **only by migrations**
(`migrations/`, applied with [Umzug](https://github.com/sequelize/umzug)).
The backend never changes the schema: on startup it connects and checks that
all migrations are applied, and **refuses to start** when the database is
unavailable, the `migrations_meta` table is missing, or migrations are
pending. (`DB_SYNC` / `sequelize.sync({ alter: true })` no longer exist; a
`DB_SYNC` variable is ignored with a warning.)

Applied migrations are recorded in the `migrations_meta` table (one `name`
column). It is only for migration tracking, never for application data.

```sql
SELECT * FROM migrations_meta
SELECT * FROM patients
SELECT * FROM patients_images
SELECT * FROM patient_images_clusters
SELECT * FROM patient_image_review_votes
```

## DICOM metadata on `patients_images`

Since migration `202609281200-patient-image-dicom-metadata`, the import
stores per image (see `services/dicom.metadata.ts`): the Study / Series /
SOP Instance / SOP Class UIDs, Modality, ImageType, Series and Instance
Number, FrameOfReferenceUID, SeriesDescription, ConvolutionKernel, IPP, IOP,
Rows, Columns, PixelSpacing, SliceThickness, RescaleSlope / Intercept,
PhotometricInterpretation, BitsStored, PixelRepresentation, NumberOfFrames,
the TransferSyntaxUID of the file meta header, the lowercase hex SHA-256 and
size of the stored file, and `slicePosition` (position along the cluster's
slice normal, the current sort key; `null` for broken images).

- The metadata is backend-internal: it is not returned by the API, and
  free-text values (SeriesDescription) are never logged.
- A missing or malformed value is stored as `NULL`; nothing is replaced by a
  default (e.g. no RescaleSlope 1 / Intercept 0).
- Images imported before this migration have `NULL` metadata until the
  backfill below reads it from the stored files.
- No indexes or unique constraints yet; they come with Study/Series.
- Not stored per image: ContrastBolusAgent (free text; for the future Series
  model), BitsAllocated, HighBit, SamplesPerPixel, window values.

Current import behavior (unchanged):

- Files without SOPInstanceUID, a complete ImagePositionPatient /
  ImageOrientationPatient, Rows or Columns are skipped as `not_an_image`.
- Part 10 files whose meta header lacks the TransferSyntaxUID are skipped as
  `dicom_parse_failed` (not parsed with a guessed transfer syntax). Files
  without a meta header are parsed as raw data sets; their
  `transferSyntaxUid` is `NULL`.
- Pixel data validity (`pixelDataProblem` in `services/dicom.service.ts`):
  native pixel data must hold at least the uncompressed size
  (`pixeldata_size(...)`). Encapsulated (compressed) pixel data is recognized
  from its structure (undefined length, fragments) and is not compared with
  the uncompressed size; it is broken without any non-empty fragment
  (`pixeldata_empty_fragments`) or without its sequence delimiter
  (`pixeldata_unterminated`). A file cut inside a fragment cannot be parsed
  and is skipped (`dicom_parse_failed`). Compressed images are not decoded;
  being importable does not make them usable for ML (see
  `transferSyntaxUid`).
- A multi-frame image is one `PatientImage` (frames are not expanded).

## Backfilling DICOM metadata of existing images

`node migrate.js backfill dicom-metadata` fills the metadata columns of
images imported before migration `202609281200-patient-image-dicom-metadata`
by reading their stored files with the same parser as the import. It is a
maintenance command: never run on startup, **dry-run unless `--apply`**.

| Option | Meaning |
| --- | --- |
| `--dry-run` | default: read and report, write nothing |
| `--apply` | write the changes |
| `--batch-size <1-1000>` | rows per batch (default 200) |
| `--report <file.json>` | also write a JSON report (not inside the upload/archive storage; never overwrites a file) |
| `--include-trashed` | also fill images of patients in the trash (they are not restored) |
| `--rescan` | re-read rows that already have a `fileSha256` (full audit) |

Environment: the backend's `DB_*` and `UPLOAD_ROOT`, plus
`REPORT_HMAC_KEY` (at least 32 characters, secret): the key for the group
identifiers in the report. Keep it stable to compare reports of different
runs. Set it in the existing ChildBEx secret environment configuration,
like the other secrets: in production `/var/www/childbex/app/.env` is a
symlink to the protected secrets location, so never create or store a
separate secret file inside a release directory.

Behavior:

- Rows needing a backfill: `fileSha256 IS NULL` (all rows with `--rescan`).
  Rows are read in batches by id (keyset), so none is skipped or repeated.
- The stored path comes only from `source`; it must resolve (also through
  symlinks) to a regular file inside `UPLOAD_ROOT`.
- Files are read one at a time, before a batch's transaction is opened.
- Only NULL columns are filled; `updatedAt`, status, review data, cluster and
  `details` are not changed. `slicePosition` = IPP · `details.normal`, as in
  the import (`NULL` for broken images).
- **A row with any conflict** (a stored value that differs from its file)
  **gets no update at all** (`metadata_conflict`, field names only): the row
  and the file may no longer describe the same DICOM instance.
- A row whose metadata changed while the run was reading files is not
  updated either (`changed_during_run`).
- Per-row results: `would_update` / `updated`, `already_complete`,
  `metadata_conflict`, `changed_during_run`, `missing_file`, `unsafe_path`,
  `read_failed`, `parse_failed`, `skipped_trashed_patient`; flags
  `missing_study_uid`, `missing_series_uid`, `missing_sop_uid`,
  `invalid_uid:<field>`, `no_slice_position`.
- Groups over all images (nothing is merged): duplicate SOP Instance UIDs
  (with or without different files), the same SOP Instance UID / Study UID /
  file under different patients, a Series UID under different studies,
  duplicate file hashes, rows sharing one stored file (hard links).
- Output contains image / patient ids, codes and counters only: no paths,
  file names, free text, UIDs or hashes (groups use `k-<HMAC>` keys).

Production run:

1. Back up the database (`pg_dump -Fc ...`).
2. `node migrate.js backfill dicom-metadata --report ~/backfill-dry-run.json`
   and review the summary, conflicts and groups.
3. `node migrate.js backfill dicom-metadata --apply --report ~/backfill-apply.json`
4. Run the dry-run again: nothing should be left to update except rows with
   problems listed in the report.

## Commands

The CLI is bundled as `migrate.js` next to `main.js` and uses the same
environment (`DB_USER`, `DB_PASS`, `DB_NAME`, `DB_HOST`; `.env` in the working
directory, and `apps/be/.env.local` when run through Nx).

| Development (repo root)             | Deployed build (`dist/apps/be`)   | What it does                                              |
| ----------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `npm run be:migrate`                | `node migrate.js up`              | apply all pending migrations                              |
| `npm run be:migrate:status`         | `node migrate.js status`          | applied / pending migrations (exit 1 if not up to date)   |
| `npm run be:migrate:down`           | `node migrate.js down`            | revert **only the latest** migration                      |
| `npm run be:migrate:baseline:check` | `node migrate.js baseline --check` | compare an existing schema with the baseline (read-only) |
| `npm run be:migrate:baseline:apply` | `node migrate.js baseline --apply` | record the baseline for an existing schema               |
| `npm run be:backfill:dicom-metadata` | `node migrate.js backfill dicom-metadata` | metadata backfill, dry-run (see above)         |
| `npm run be:backfill:dicom-metadata:apply` | `node migrate.js backfill dicom-metadata --apply` | metadata backfill, write              |

The `npm run` commands build the backend first. To target another database
than the one in `apps/be/.env.local`, set the variable in the shell (it takes
precedence), e.g. `DB_NAME=other_db npm run be:migrate:status`.

## New environment

1. Create the database: `createdb childbex` (or `CREATE DATABASE childbex;`).
2. Set `DB_*` for it.
3. Apply the migrations: `npm run be:migrate` (deployed: `node migrate.js up`).
4. Check: `npm run be:migrate:status` — everything `applied`, nothing `pending`.
5. Start the backend.

## Existing environment (created before migrations)

Databases created by the old startup `sync({ alter: true })` already have the
schema but no `migrations_meta`. Do **not** run `up` there (it refuses: the
baseline would try to recreate existing tables). Instead record the baseline
once, after checking that the live schema really is the expected one:

1. **Back up** the database: `pg_dump -Fc -f childbex-before-baseline.dump <db>`.
2. **Inspect** the live schema, e.g. `psql <db> -c '\d+ patients'` (and the
   other three tables), and run the read-only check:
   `npm run be:migrate:baseline:check` (deployed: `node migrate.js baseline --check`).
   - `ERROR` lines (missing tables/columns, other types or nullability,
     missing enum values, unique indexes, foreign keys): the application
     would not work correctly on this schema. **Stop** and resolve it
     manually; nothing is changed or recorded.
   - `WARNING` lines are left for review and later cleanup by a dedicated
     migration, e.g. `N duplicate unique indexes on patients_images(source)`
     (every old startup's `alter` added another copy), unexpected extra
     columns or enum values.
3. **Record** the baseline: `npm run be:migrate:baseline:apply`
   (deployed: `node migrate.js baseline --apply`). It repeats the check,
   refuses on errors, and only inserts the baseline name into
   `migrations_meta`. The schema and data are not changed.
4. **Verify**: `npm run be:migrate:status` — the baseline is `applied`.
5. From now on apply future migrations with `npm run be:migrate`.

The baseline migration (`202609280000-baseline-schema`) is **not reversible**:
`down` refuses instead of dropping all tables and data.

## Development

- **Create a migration**: add `migrations/YYYYMMDDHHmm-<description>.ts`
  exporting a `Migration` (`name` equal to the file name, `up`, and `down`
  when reverting is safe), and append it to the list in `migrations/index.ts`
  (migrations are bundled, not discovered from the file system; the list
  order is the order of application).
  - Run the changes in a transaction (`sequelize.transaction(...)`); DDL is
    transactional in PostgreSQL. Exceptions that cannot run in a
    transaction (e.g. `CREATE INDEX CONCURRENTLY`) need their own migration.
  - Never import application models: a migration must keep doing exactly the
    same even when the models change later. Use SQL or `queryInterface`.
  - Update the model definitions in the same change.
- **Apply**: `npm run be:migrate`
- **Status**: `npm run be:migrate:status`
- **Roll back the latest**: `npm run be:migrate:down`

### Tests

Unit tests need no database. The PostgreSQL migration tests
(`migrations.integration.spec.ts`) run only when `TEST_DATABASE_URL` points to
a **dedicated test database** whose name contains `test` — every test drops
and recreates its `public` schema:

```sh
createdb childbex_migrations_test
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/childbex_migrations_test npm run be:test
```

Without `TEST_DATABASE_URL` they are reported as skipped.

## Production

1. **Back up** the database (`pg_dump -Fc ...`) before every migration.
2. Deploy the new build **without restarting** the backend yet.
3. Run the migrations explicitly in the deployment directory, with the same
   environment as the backend: `node migrate.js up`.
4. Verify: `node migrate.js status` (exit code 0, nothing pending).
5. Restart the backend (e.g. `pm2 restart app.childbex`).

Migrations never run automatically on startup; a backend started before step
3 refuses to start and names the pending migrations.
