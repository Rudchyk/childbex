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

## DICOM Study and Series

Since migration `202609291200-study-series`:
`Patient -> Study -> Series -> PatientImage` (`patients_images.seriesId`),
in parallel with `Patient -> PatientImagesCluster -> PatientImage` during
the transition (the cluster API and GUI are unchanged; `seriesId` is not
returned by the API).

- `studies`: `patientId`, `studyInstanceUid` (UNIQUE), `studyDate`
  (DICOM DA as a date, no time zone), `studyTime` (DICOM TM as recorded).
- `series`: `studyId`, `seriesInstanceUid` (UNIQUE), `seriesNumber`,
  `seriesDescription` (free text, never logged), `modality`, `imageType`,
  `frameOfReferenceUid`, `convolutionKernel`, `sliceThickness`. A field is
  only set to a value all its images agree on; stored values are never
  overwritten (differences are logged with ids and field names only).
- Rows are created with `INSERT ... ON CONFLICT DO NOTHING` and read back
  (`services/dicom-hierarchy.service.ts`), in UID order: concurrent imports
  of one study create it once. A Study UID stored for another patient or a
  Series UID of another study rejects the whole archive
  (`STUDY_BELONGS_TO_ANOTHER_PATIENT` / `SERIES_BELONGS_TO_ANOTHER_STUDY`);
  nothing is re-parented.
- Images without both UIDs stay unlinked (`seriesId` NULL).
- Deleting: studies and series follow the patient (ON DELETE CASCADE); an
  image prevents its series from being deleted (NO ACTION). Deleting a
  cluster deletes its images and files as before, but not the studies and
  series (they may be left without images).

### DICOM instance identity (import deduplication)

An image is identified by its **SOP Instance UID**; the file SHA-256 tells
whether a known UID comes with the same content. File names, storage paths
(`source`) and clusters are not identity (a file name already taken in the
cluster only gets a `_1`, `_2`, ... suffix). See
`services/instance-dedup.service.ts`.

| Archive image vs. stored images | Result |
| --- | --- |
| New SOP UID | imported |
| Same SOP UID, same hash, same patient / study / series (any cluster) | `alreadyImported`: no row, no file; the stored row (id, cluster, review state, votes, metadata) is unchanged |
| Same SOP UID, other hash, or a stored row without hash | archive rejected: `SOP_INSTANCE_CONTENT_CONFLICT` |
| Same SOP UID stored for another patient (also in the trash) | archive rejected: `SOP_INSTANCE_BELONGS_TO_ANOTHER_PATIENT` |
| Same SOP UID in another study or series | archive rejected: `SOP_INSTANCE_BELONGS_TO_ANOTHER_SERIES` |
| Same SOP UID twice in one archive | same hash: one row (`alreadyImported`); other hash: `SOP_INSTANCE_CONTENT_CONFLICT` |
| Other SOP UID, hash stored under another UID (legacy inconsistency) | imported; `possible_duplicate_content` warning (image ids only) |
| No SOP UID | unchanged: skipped as `not_an_image` |

Broken images follow the same rules. A rejected archive rolls back its
transaction (studies, series, clusters, images) and removes every file it
placed. The decision is taken before any file is placed.

The persistence phase of every import (one transaction: hierarchy,
deduplication, file placement, inserts) runs under one global
transaction-level advisory lock (`IMPORT_PERSISTENCE_LOCK_KEY`), so
concurrent imports cannot both insert an instance; extraction and parsing
run in parallel. `patients_images.sopInstanceUid` and `fileSha256` have
non-unique indexes (migration `202609301200-patient-image-instance-indexes`);
a UNIQUE constraint needs a cleanup of legacy duplicates first (see the
`backfill dicom-metadata` report).

Images imported before migration `202609281200-patient-image-dicom-metadata`
have no SOP UID until `backfill dicom-metadata` fills it: run it right after
deploying, otherwise a re-upload of such an instance is not recognized.

### Legacy duplicate SOP instances: `cleanup duplicate-sop`

`node migrate.js cleanup duplicate-sop` audits rows sharing one non-null SOP
Instance UID (groups of 2+, all patients including trashed ones) and cleans
only unambiguous ones. Dry-run unless `--apply`; never run on startup.
Options: `--apply`, `--dry-run`, `--report <file.json>` (same rules as above),
`--group k-<16 hex>` (a group key from a report: a selector only, the group
is still fully revalidated). Needs `REPORT_HMAC_KEY` and `UPLOAD_ROOT`. Group
keys equal the SOP keys of the `backfill dicom-metadata` report.

Classification, first match wins:

| # | Class | When | Cleaned |
| - | --- | --- | --- |
| 1 | `OWNER_CONFLICT` | rows of different patients | never |
| 2 | `STUDY_SERIES_CONFLICT` | different Study / Series UID, or different set `seriesId` | never |
| 3 | `UNVERIFIED` | a row without `fileSha256` | never |
| 4 | `CONTENT_CONFLICT` | different `fileSha256` | never |
| 5 | `METADATA_CONFLICT` | same hash, different stored DICOM metadata (`slicePosition` excepted) | never |
| 6 | `FILE_PROBLEM` | a file missing, outside the storage, not a regular file, unreadable, or its SHA-256 differs from `fileSha256` | never |
| 7 | `REVIEW_CONFLICT` | review data on two or more rows | never |
| 8 | `SAFE_IDENTICAL` | otherwise (different clusters are fine) | yes |

Review data on a row: votes, vote counters, an admin resolution (id, name,
comment, date), a status other than `not_reviewed` / `broken`, or notes (not
the technical notes of a broken image). Nothing is merged.

For `SAFE_IDENTICAL`: the canonical row is the reviewed row if any, else the
oldest (`createdAt`), else the smallest id. It is kept exactly as it is
(cluster, review data, votes, metadata); the other rows (all without review
data) are deleted with raw SQL (no model hooks). Emptied clusters are only
reported (`emptyClusters`).

Apply, per group: one transaction under the import advisory lock (imports
wait, and the cleanup waits for a running import), rows locked `FOR UPDATE`
(also blocks new votes on them), then rows, review data, classification and
file hashes are read again. Any difference from the scan
(`changed_during_run`) or an error (`failed`) rolls the group back
unchanged. Files are deleted after the commit, only if their stored path has
no symlink/junction and is not the canonical file: a hard link to the
canonical file only loses this name (`hardlink_name_removed`), otherwise
`file_removed` / `file_kept`. A failed file deletion leaves an extra file,
reported as `file_delete_failed` for manual removal; never a row without its
image.

### Unique SOP Instance UID

Migration `202609301800-patient-image-sop-unique` replaces the non-unique
`patients_images_sop_instance_uid` with the UNIQUE index
`patients_images_sop_instance_uid_unique` (NULLs remain allowed: images
without a SOP UID stay supported). It locks `patients_images` against writes
(`SHARE`), counts duplicate non-null SOP UIDs and, if there are any, fails
without changes, naming only their number, e.g.:

```
Cannot enforce a unique SOP Instance UID: 2 duplicate group(s) exist. Run
`node migrate.js cleanup duplicate-sop` (dry-run, resolve conflict groups
manually, then --apply) until it reports duplicateGroups: 0, then run the
migrations again.
```

Conflict groups are never deleted automatically; they must be resolved by
hand. Rolling the migration back restores the non-unique index (no data is
touched).

The import keeps its own deduplication (under the import lock), so users get
`alreadyImported` or the explicit `SOP_INSTANCE_*` conflicts, never a database
error; the index is the last line of defense. With the index in place,
`backfill dicom-metadata` does not fill a SOP UID already stored on another
image (`sop_instance_already_stored`, no update of that row); before it, it
fills legacy duplicates so that `cleanup duplicate-sop` can find them.

Maintenance commands only need the migrations they depend on (`backfill
dicom-metadata`: 202609281200, `backfill study-series`: 202609291200,
`cleanup duplicate-sop`: 202609301200); later ones may be pending. The backend
itself starts only when all migrations are applied.

### Production order for the unique SOP index

`node migrate.js up` applies every pending migration, so stop before the
unique index with `--to` until the data is clean (otherwise legacy rows
without a SOP UID yet would pass the check unseen):

1. Back up the database (`pg_dump -Fc ...`).
2. Deploy the code (PR3, PR4, PR4.1, PR4.2, PR4.3) without restarting, then
   `node migrate.js up --to 202609301200-patient-image-instance-indexes`.
3. `node migrate.js backfill dicom-metadata --report ~/backfill-dry-run.json`,
   review, then `--apply --report ~/backfill-apply.json`.
4. `node migrate.js backfill study-series --report ~/study-series-dry-run.json`,
   review, then `--apply --report ~/study-series-apply.json`.
5. `node migrate.js cleanup duplicate-sop --report ~/dup-sop-dry-run.json`.
6. Resolve every group that is not `SAFE_IDENTICAL` manually (there is no
   force option).
7. `node migrate.js cleanup duplicate-sop --apply --report ~/dup-sop-apply.json`
   (all safe groups, or one at a time with `--group k-...`).
8. Repeat the dry-run of step 5.
9. Verify it reports `duplicateGroups: 0`.
10. `node migrate.js up` (applies the unique index).
11. `node migrate.js status` (exit code 0, nothing pending).
12. Restart the backend and resume normal operation.

### Linking existing images: `backfill study-series`

`node migrate.js backfill study-series` links images imported before the
migration, from the UIDs already stored on them. Dry-run unless `--apply`;
never run on startup. Options: `--apply`, `--dry-run`, `--report <file.json>`
(same rules as above), `--include-trashed`. Needs `REPORT_HMAC_KEY` and
`UPLOAD_ROOT` like `backfill dicom-metadata`.

- Only rows with `fileSha256 IS NOT NULL` are used. The hash value itself is
  not used: it marks that the row's metadata was read completely and without
  conflict (by the import or `backfill dicom-metadata`). Rows with UIDs but no
  hash (e.g. `metadata_conflict` rows of that backfill) are reported as
  `metadata_not_verified` and are not linked. Run `backfill dicom-metadata`
  first.
- A Study UID under several patients or a Series UID under several studies
  (among these rows and the existing studies/series) is reported as a
  conflict; none of its images is linked.
- StudyDate / StudyTime are read from one file per study (the lowest image
  id; same safe path resolution). When unavailable they stay NULL with a
  warning, and the images are linked anyway.
- One transaction per study; only `seriesId` changes (`updatedAt`, status and
  review data are unchanged). Rerunning is idempotent.
- Per-row results: `would_link` / `linked`, `metadata_not_verified`,
  `missing_study_uid`, `missing_series_uid`, `study_ownership_conflict`,
  `series_ownership_conflict`, `changed_during_run`,
  `skipped_trashed_patient`.

Production order: back up, apply the migration, run
`backfill dicom-metadata` (dry-run, then `--apply`), then
`backfill study-series --report ~/study-series-dry-run.json`, review, then
`--apply --report ~/study-series-apply.json`.

## Commands

The CLI is bundled as `migrate.js` next to `main.js` and uses the same
environment (`DB_USER`, `DB_PASS`, `DB_NAME`, `DB_HOST`; `.env` in the working
directory, and `apps/be/.env.local` when run through Nx).

| Development (repo root)             | Deployed build (`dist/apps/be`)   | What it does                                              |
| ----------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `npm run be:migrate`                | `node migrate.js up`              | apply all pending migrations                              |
| —                                   | `node migrate.js up --to <name>`  | apply pending migrations up to and including `<name>`     |
| `npm run be:migrate:status`         | `node migrate.js status`          | applied / pending migrations (exit 1 if not up to date)   |
| `npm run be:migrate:down`           | `node migrate.js down`            | revert **only the latest** migration                      |
| `npm run be:migrate:baseline:check` | `node migrate.js baseline --check` | compare an existing schema with the baseline (read-only) |
| `npm run be:migrate:baseline:apply` | `node migrate.js baseline --apply` | record the baseline for an existing schema               |
| `npm run be:backfill:dicom-metadata` | `node migrate.js backfill dicom-metadata` | metadata backfill, dry-run (see above)         |
| `npm run be:backfill:dicom-metadata:apply` | `node migrate.js backfill dicom-metadata --apply` | metadata backfill, write              |
| `npm run be:backfill:study-series` | `node migrate.js backfill study-series` | Study/Series linking, dry-run                       |
| `npm run be:backfill:study-series:apply` | `node migrate.js backfill study-series --apply` | Study/Series linking, write             |
| `npm run be:cleanup:duplicate-sop` | `node migrate.js cleanup duplicate-sop` | duplicate SOP audit, dry-run                        |
| `npm run be:cleanup:duplicate-sop:apply` | `node migrate.js cleanup duplicate-sop --apply` | clean SAFE_IDENTICAL duplicate groups   |

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
