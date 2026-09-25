# ChildBEx

## Study archive upload

Study archives (up to 500 MiB) are uploaded in chunks through a resumable
upload session; the GUI does this automatically and shows progress. All
endpoints are under `/api/v1` and require Keycloak authentication; a session
is only visible to the user who created it.

| Step            | Request                                                                           | Notes                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create          | `POST /patients/:id/upload-sessions` `{ fileName, fileSize, clientFingerprint? }` | Returns `uploadId`, `chunkSize`, `totalChunks`. The extension is checked here; the file name is not stored. `clientFingerprint` is an opaque client identifier (`[A-Za-z0-9_-]{16,128}`) used to find the session again.     |
| Upload chunks   | `PUT /upload-sessions/:uploadId/chunks/:index` (raw bytes)                        | Headers `x-chunk-count` (total chunks), `x-chunk-sha256` (hex SHA-256, required), `Content-Length` (exact chunk size). Chunks may be sent in any order and in parallel; a repeated chunk with the same checksum returns 200. |
| List unfinished | `GET /upload-sessions`                                                            | The caller's unfinished sessions (uploading, processing, retryable failures), e.g. to resume after a page reload or discard abandoned uploads.                                                                               |
| Resume / status | `GET /upload-sessions/:uploadId`                                                  | `receivedChunks`, `missingChunks`, `status`, `error`, `result`.                                                                                                                                                              |
| Complete        | `POST /upload-sessions/:uploadId/complete`                                        | 202; assembles the chunks in order, re-verifies checksums and imports the archive in the background. Poll the status until `completed` or `failed`.                                                                          |
| Cancel          | `DELETE /upload-sessions/:uploadId`                                               | Deletes the temporary data (not possible while processing).                                                                                                                                                                  |

The assembled archive goes through the same validation, safe extraction and
DICOM import as before. Session state and chunks are kept on the file system
in `UPLOAD_SESSIONS_DIR` (single backend instance). Unfinished sessions expire
after `UPLOAD_SESSION_TTL_MS` of inactivity; a cleanup job removes expired
sessions and stale partial chunks and recovers uploads interrupted by a restart.
Trashing or deleting a patient removes that patient's unfinished uploads.

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

| Variable                          | Default                             | Purpose                                                                                         |
| --------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `UPLOAD_ROOT`                     | `./uploads`                         | Imported image files (served under `/uploads`).                                                 |
| `ARCHIVES_ROOT`                   | `./archives`                        | Private storage for original archives. Must not be inside `UPLOAD_ROOT`. Never served.          |
| `UPLOAD_SESSIONS_DIR`             | `<os tmp>/childbex-upload-sessions` | Private storage for upload sessions and chunks. Must not be inside `UPLOAD_ROOT`. Never served. |
| `UPLOAD_CHUNK_SIZE_BYTES`         | `33554432` (32 MiB)                 | Chunk size (8–50 MiB).                                                                          |
| `UPLOAD_SESSION_TTL_MS`           | `86400000` (24 h)                   | Inactivity period after which an unfinished upload is deleted.                                  |
| `UPLOAD_SESSIONS_MAX_PER_USER`    | `3`                                 | Unfinished uploads per user.                                                                    |
| `UPLOAD_SESSIONS_MAX_TOTAL_BYTES` | `5368709120` (5 GiB)                | Total size of all unfinished uploads.                                                           |
| `ARCHIVE_WORK_DIR`                | `<os tmp>/childbex-uploads`         | Per-upload temporary workspaces (removed after every upload).                                   |
| `ARCHIVE_MAX_UPLOAD_BYTES`        | `524288000` (500 MiB)               | Max archive size (assembled upload). Cannot be raised above the shared 500 MiB limit.           |
| `ARCHIVE_MAX_EXTRACTED_BYTES`     | `4294967296` (4 GiB)                | Max total extracted size.                                                                       |
| `ARCHIVE_MAX_ENTRY_BYTES`         | `1073741824` (1 GiB)                | Max size of one extracted file.                                                                 |
| `ARCHIVE_MAX_ENTRIES`             | `50000`                             | Max number of archive entries.                                                                  |
| `ARCHIVE_MAX_PATH_DEPTH`          | `32`                                | Max directory depth of an entry path.                                                           |
| `ARCHIVE_MAX_PATH_LENGTH`         | `1024`                              | Max entry path length (characters).                                                             |
| `ARCHIVE_EXTRACTION_TIMEOUT_MS`   | `900000` (15 min)                   | Max extraction duration.                                                                        |

Invalid values stop the backend at startup.

Archives created before this change were stored as Brotli-compressed tar
(`*.br`); they can still be unpacked with `brotli -d file.br -o file.tar`.
