"""Machine-readable cloud artifact errors (fixed messages; `detail` names a
schema location, never a value)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    # Build
    "OUTPUT_EXISTS": "The artifact directory already exists.",
    "OUTPUT_PARENT_MISSING": "The parent directory of the artifact does not exist.",
    "OUTPUT_INSIDE_SOURCE": "The artifact must not be written inside the source export.",
    "PROVENANCE_EXISTS": "The provenance file already exists.",
    "PROVENANCE_PARENT_MISSING": "The directory of the provenance file does not exist.",
    "PROVENANCE_INSIDE_ARTIFACT": "The provenance file must not be inside the cloud artifact.",
    "PIXEL_GATE_FAILED": "One or more images failed PIXEL_GATE_V1; nothing was written.",
    "INVALID_SHARD_SIZE": "The shard size must be a positive integer.",
    # Artifact validation (reader / verify)
    "ARTIFACT_INCOMPLETE": "The artifact is missing or has an invalid completion marker.",
    "ARTIFACT_MARKER_MISMATCH": "The completion marker does not match the manifest.",
    "ARTIFACT_HASH_MISMATCH": "The manifest does not match the artifactSha256 in the completion marker.",
    "INVALID_ARTIFACT_MANIFEST": "The manifest does not follow cloud artifact schema version 1.",
    "DUPLICATE_SAMPLE": "The manifest contains a duplicate sample, patient or shard position.",
    "SPLIT_INTEGRITY_ERROR": "The manifest violates patient-level split integrity.",
    "COUNT_MISMATCH": "The manifest counts are inconsistent.",
    "ARTIFACT_FILE_MISSING": "A file of the artifact is missing.",
    "UNEXPECTED_ARTIFACT_FILE": "The artifact contains files that are not part of it.",
    "ARTIFACT_FILE_NOT_REGULAR": "An artifact file is a symlink or not a regular file.",
    "INVALID_SHARD": "A tensor shard is not a valid little-endian float32 C-order .npy array of the expected shape.",
    "SHARD_HASH_MISMATCH": "A tensor shard does not match its SHA-256.",
    "TENSOR_HASH_MISMATCH": "A sample tensor does not match its SHA-256.",
}


class CloudArtifactError(Exception):
    def __init__(
        self,
        code: str,
        *,
        detail: str | None = None,
        failures: list[dict] | None = None,
        count: int | None = None,
    ) -> None:
        if code not in MESSAGES:
            raise ValueError("unknown cloud artifact error code")
        super().__init__(MESSAGES[code] + (f" ({detail})" if detail else ""))
        self.code = code
        self.detail = detail
        self.failures = failures or []
        self.count = count
