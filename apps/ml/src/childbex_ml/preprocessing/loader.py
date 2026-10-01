"""Integrity-checked reading of an original DICOM file.

The caller resolves the file (PR9 never reads the ChildBEx database or
PatientImage.source); the expected SHA-256 and size come from the
DatasetSnapshot item. The bytes returned are exactly the bytes verified.
"""

from __future__ import annotations

import hashlib
import os
import re

from .errors import PreprocessingError

_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def load_verified_bytes(path: str | os.PathLike, expected_sha256: str, expected_size: int) -> bytes:
    if not isinstance(expected_sha256, str) or not _SHA256.match(expected_sha256):
        raise ValueError("expected_sha256 must be 64 lowercase hex characters")
    if isinstance(expected_size, bool) or not isinstance(expected_size, int) or expected_size < 0:
        raise ValueError("expected_size must be a non-negative integer")
    try:
        if os.stat(path).st_size != expected_size:
            raise PreprocessingError("FILE_INTEGRITY_MISMATCH")
        with open(path, "rb") as handle:
            data = handle.read(expected_size + 1)
    except OSError:
        raise PreprocessingError("FILE_NOT_READABLE") from None
    if len(data) != expected_size or hashlib.sha256(data).hexdigest() != expected_sha256:
        raise PreprocessingError("FILE_INTEGRITY_MISMATCH")
    return data
