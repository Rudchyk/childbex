# ChildBEx

## Study archive upload

Studies are uploaded as a single archive per request
(`POST /patients/:id/upload`, form field `archive`).

Supported formats (extension **and** content signature are validated):
`.zip`, `.tar`, `.tar.gz` / `.tgz`, `.tar.bz2` / `.tbz2`, `.tar.xz` / `.txz`.

Not supported: RAR and 7z (rejected with a message asking to repack as ZIP),
encrypted archives, archives nested inside the uploaded archive.

DICOM files are found by parsing every extracted regular file (a `.dcm`
extension or a `DICM` preamble is not required). Unrelated files and OS
metadata (`__MACOSX`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `DICOMDIR`)
are skipped. The upload is rejected when it contains no usable DICOM image.

The original uploaded archive is stored byte-for-byte in `ARCHIVES_ROOT` as
`<uploadId><ext>` with a `<uploadId>.json` sidecar (patient id, format, size,
SHA-256). The client file name is not stored.

### Environment variables

| Variable                        | Default                     | Purpose                                                                                |
| ------------------------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `UPLOAD_ROOT`                   | `./uploads`                 | Imported image files (served under `/uploads`).                                        |
| `ARCHIVES_ROOT`                 | `./archives`                | Private storage for original archives. Must not be inside `UPLOAD_ROOT`. Never served. |
| `ARCHIVE_WORK_DIR`              | `<os tmp>/childbex-uploads` | Per-upload temporary workspaces (removed after every upload).                          |
| `ARCHIVE_MAX_UPLOAD_BYTES`      | `524288000` (500 MiB)       | Max uploaded archive size. Cannot be raised above 500 MiB until chunked upload exists. |
| `ARCHIVE_MAX_EXTRACTED_BYTES`   | `4294967296` (4 GiB)        | Max total extracted size.                                                              |
| `ARCHIVE_MAX_ENTRY_BYTES`       | `1073741824` (1 GiB)        | Max size of one extracted file.                                                        |
| `ARCHIVE_MAX_ENTRIES`           | `50000`                     | Max number of archive entries.                                                         |
| `ARCHIVE_MAX_PATH_DEPTH`        | `32`                        | Max directory depth of an entry path.                                                  |
| `ARCHIVE_MAX_PATH_LENGTH`       | `1024`                      | Max entry path length (characters).                                                    |
| `ARCHIVE_EXTRACTION_TIMEOUT_MS` | `900000` (15 min)           | Max extraction duration.                                                               |

Invalid values stop the backend at startup.

Archives created before this change were stored as Brotli-compressed tar
(`*.br`); they can still be unpacked with `brotli -d file.br -o file.tar`.
