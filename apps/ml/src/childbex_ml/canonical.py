"""Canonical JSON and SHA-256 for hashed ML artifacts (preprocessing
configurations, dataset export manifests, preflight identities).

The Node backend writes export manifests with the same rules
(apps/be services/dataset-snapshot/canonical-json.ts); both test suites
share a golden vector.
"""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any


class CanonicalJsonError(ValueError):
    """A value that has no canonical JSON form."""


def _canonical_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _canonical_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise CanonicalJsonError("non-finite numbers cannot be serialized")
        if value.is_integer() and abs(value) < 2**53:
            return int(value)
        text = repr(value)
        if "e" in text or "E" in text:
            raise CanonicalJsonError("numbers needing an exponent are not supported in the canonical form")
        return value
    raise CanonicalJsonError("unsupported value type in configuration")


def canonical_json(value: Any) -> str:
    """Canonical JSON: sorted keys, no whitespace, UTF-8, integral numbers
    written as integers (40.0 -> 40), other numbers in the shortest
    round-trip decimal form; non-finite numbers and exponents are rejected.
    For the values schema version 1 allows this matches RFC 8785 (JCS).
    """
    return json.dumps(
        _canonical_value(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def hash_canonical(value: Any) -> str:
    """Lowercase hex SHA-256 of the canonical JSON (UTF-8) of any value."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()
