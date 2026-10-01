"""Machine-readable dataset errors.

Messages are fixed per code. `detail` may name a schema location (e.g.
`items[3].fileSha256`) but never a value read from a manifest or a file;
`failures` lists internal UUIDs and codes only.
"""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # Export / manifest (folder level: stops before any item is processed)
    "EXPORT_INCOMPLETE": "The export is missing or has an invalid completion marker.",
    "EXPORT_MARKER_MISMATCH": "The completion marker does not match the manifest.",
    "MANIFEST_HASH_MISMATCH": "The manifest does not match the hash in the completion marker.",
    "INVALID_MANIFEST": "The manifest does not follow manifest schema version 1.",
    "SNAPSHOT_NOT_FINALIZED": "Only FINALIZED or ARCHIVED snapshots can be used.",
    "DUPLICATE_ITEM": "The manifest contains a duplicate item.",
    "SNAPSHOT_SPLIT_INTEGRITY_ERROR": "The manifest violates patient-level split integrity.",
    "SNAPSHOT_COUNT_MISMATCH": "The manifest counts are inconsistent.",
    "UNEXPECTED_EXPORT_FILE": "The export contains files that are not in the manifest.",
    "EXPORT_FILE_NOT_REGULAR": "An exported DICOM file is a symlink or not a regular file.",
    # Item level
    "FILE_MISSING": "An exported DICOM file is missing.",
    "FILE_INTEGRITY_MISMATCH": "A file does not match its expected size or SHA-256.",
    "PREPROCESSING_FAILED": "Preprocessing failed unexpectedly.",
    "TENSOR_CONTRACT_VIOLATION": "The preprocessed tensor violates the output contract.",
    # Preflight binding
    "PREFLIGHT_REQUIRED": "No preflight report exists for this export and configuration.",
    "PREFLIGHT_FAILED": "The preflight report for this export and configuration did not pass.",
    "PREFLIGHT_STALE": "The preflight report does not match this export, configuration or runtime; run preflight again here.",
}


class DatasetError(Exception):
    def __init__(
        self,
        code: str,
        *,
        detail: str | None = None,
        patient_image_id: str | None = None,
        failures: list[dict] | None = None,
        count: int | None = None,
    ) -> None:
        if code not in MESSAGES:
            raise ValueError("unknown dataset error code")
        super().__init__(MESSAGES[code] + (f" ({detail})" if detail else ""))
        self.code = code
        self.detail = detail
        self.patient_image_id = patient_image_id
        self.failures = failures or []
        self.count = count
