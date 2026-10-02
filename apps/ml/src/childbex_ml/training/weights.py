"""Versioned pretrained-weight specification and resolver.

The official Keras 3.11.3 EfficientNetV2B0 no-top ImageNet weights
(`keras/src/applications/efficientnet_v2.py`: BASE_WEIGHTS_PATH and
WEIGHTS_HASHES["b0"][1]). The file is resolved with the public
`keras.utils.get_file` (which verifies the official MD5), its SHA-256 is
computed, and the local path is passed explicitly to EfficientNetV2B0.
Tests inject a local resolver and never download anything.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .errors import TrainingError


@dataclass(frozen=True)
class WeightSpec:
    spec: str
    source: str
    file_name: str
    origin: str
    official_checksum: str
    checksum_algorithm: str


EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1 = WeightSpec(
    spec="EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1",
    source="keras==3.11.3 keras.applications.EfficientNetV2B0 imagenet (include_top=False)",
    file_name="efficientnetv2-b0_notop.h5",
    origin="https://storage.googleapis.com/tensorflow/keras-applications/efficientnet_v2/efficientnetv2-b0_notop.h5",
    official_checksum="893217f2bb855e2983157299931e43ff",
    checksum_algorithm="md5",
)

SPECS = {EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1.spec: EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1}

# A fetcher has the signature of keras.utils.get_file(fname, origin, file_hash=, hash_algorithm=, cache_subdir=).
Fetcher = Callable[..., str]


def _keras_get_file(**kwargs) -> str:
    import keras

    return keras.utils.get_file(**kwargs)


def file_sha256(path: str | Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_weights(spec_name: str, fetch: Fetcher | None = None) -> tuple[Path, dict]:
    """(local weight file, provenance). Fails with WEIGHTS_UNAVAILABLE."""
    spec = SPECS.get(spec_name)
    if spec is None:
        raise TrainingError("WEIGHTS_UNAVAILABLE", "unknown weight specification")
    fetch = fetch or _keras_get_file
    try:
        path = Path(
            fetch(
                fname=spec.file_name,
                origin=spec.origin,
                file_hash=spec.official_checksum,
                hash_algorithm=spec.checksum_algorithm,
                cache_subdir="models",
            )
        )
    except Exception:
        raise TrainingError("WEIGHTS_UNAVAILABLE", "download or checksum verification failed") from None
    if not path.is_file():
        raise TrainingError("WEIGHTS_UNAVAILABLE", "resolved file missing")
    official = hashlib.new(spec.checksum_algorithm, path.read_bytes()).hexdigest()
    if official != spec.official_checksum:
        raise TrainingError("WEIGHTS_UNAVAILABLE", "official checksum mismatch")
    return path, {
        "weightSpec": spec.spec,
        "source": spec.source,
        "origin": spec.origin,
        "fileName": spec.file_name,
        "officialChecksum": spec.official_checksum,
        "officialChecksumAlgorithm": spec.checksum_algorithm,
        "sha256": file_sha256(path),
    }
