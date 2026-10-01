"""Structured pixel-review attestation (schema version 1).

A controlled-side JSON document in which an operator asserts, for exactly one
PR10 export (bound by its manifestSha256), that every included image was
reviewed for visible identifiers and that the data is chest CT without head
CT. It is never copied into a cloud artifact; only its SHA-256 and fields go
into the controlled provenance file.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

from ..canonical import hash_canonical

ATTESTATION_SCHEMA_VERSION = 1
KEYS = {
    "attestationSchemaVersion",
    "manifestSha256",
    "scope",
    "pixelReview",
    "bodyRegion",
    "headCtIncluded",
    "reviewedAt",
    "reviewerReference",
}
SHA256 = re.compile(r"^[0-9a-f]{64}$")
# Opaque internal reference: no spaces (names), no "@" (e-mail addresses), no
# path separators.
REVIEWER_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
ISO_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$")

MESSAGES = {
    "ATTESTATION_MISSING": "The pixel-review attestation file is missing or unreadable.",
    "ATTESTATION_INVALID": "The pixel-review attestation does not follow attestation schema version 1.",
    "ATTESTATION_MANIFEST_MISMATCH": "The attestation does not refer to this export (manifestSha256).",
    "ATTESTATION_SCOPE_UNSUPPORTED": "The attestation does not assert what a v1 cloud artifact requires.",
}


class AttestationError(Exception):
    def __init__(self, code: str, detail: str | None = None) -> None:
        super().__init__(MESSAGES[code] + (f" ({detail})" if detail else ""))
        self.code = code
        self.detail = detail


def _reject_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise AttestationError("ATTESTATION_INVALID", "duplicate key")
    return dict(pairs)


def validate_attestation(raw: object, manifest_sha256: str) -> dict:
    """Returns the validated attestation; `detail` names a field, never a value."""
    if not isinstance(raw, dict):
        raise AttestationError("ATTESTATION_INVALID", "document")
    unknown, missing = set(raw) - KEYS, KEYS - set(raw)
    if unknown:
        raise AttestationError("ATTESTATION_INVALID", "unknown field")
    if missing:
        raise AttestationError("ATTESTATION_INVALID", "missing field")
    version = raw["attestationSchemaVersion"]
    if isinstance(version, bool) or version != ATTESTATION_SCHEMA_VERSION:
        raise AttestationError("ATTESTATION_INVALID", "attestationSchemaVersion")
    if not isinstance(raw["manifestSha256"], str) or not SHA256.match(raw["manifestSha256"]):
        raise AttestationError("ATTESTATION_INVALID", "manifestSha256")
    for key in ("scope", "pixelReview", "bodyRegion", "reviewedAt", "reviewerReference"):
        if not isinstance(raw[key], str):
            raise AttestationError("ATTESTATION_INVALID", key)
    if not isinstance(raw["headCtIncluded"], bool):
        raise AttestationError("ATTESTATION_INVALID", "headCtIncluded")
    if not ISO_TIMESTAMP.match(raw["reviewedAt"]):
        raise AttestationError("ATTESTATION_INVALID", "reviewedAt")
    try:
        datetime.fromisoformat(raw["reviewedAt"].replace("Z", "+00:00"))
    except ValueError:
        raise AttestationError("ATTESTATION_INVALID", "reviewedAt") from None
    if not REVIEWER_REFERENCE.match(raw["reviewerReference"]):
        raise AttestationError("ATTESTATION_INVALID", "reviewerReference")

    if raw["manifestSha256"] != manifest_sha256:
        raise AttestationError("ATTESTATION_MANIFEST_MISMATCH")
    if raw["scope"] != "ALL_INCLUDED_IMAGES":
        raise AttestationError("ATTESTATION_SCOPE_UNSUPPORTED", "scope")
    if raw["pixelReview"] != "NO_VISIBLE_IDENTIFIERS_OBSERVED":
        raise AttestationError("ATTESTATION_SCOPE_UNSUPPORTED", "pixelReview")
    if raw["bodyRegion"] != "CHEST":
        raise AttestationError("ATTESTATION_SCOPE_UNSUPPORTED", "bodyRegion")
    if raw["headCtIncluded"] is not False:
        raise AttestationError("ATTESTATION_SCOPE_UNSUPPORTED", "headCtIncluded")
    return dict(raw)


def load_attestation(path: str | os.PathLike, manifest_sha256: str) -> tuple[dict, str]:
    """(validated attestation, attestationSha256)."""
    try:
        text = Path(path).read_text("utf-8")
    except (OSError, UnicodeDecodeError):
        raise AttestationError("ATTESTATION_MISSING") from None
    try:
        raw = json.loads(text, object_pairs_hook=_reject_duplicate_keys)
    except json.JSONDecodeError:
        raise AttestationError("ATTESTATION_INVALID", "not JSON") from None
    attestation = validate_attestation(raw, manifest_sha256)
    return attestation, hash_canonical(attestation)
