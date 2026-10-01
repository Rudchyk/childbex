"""NumPy-only reader for cloud artifacts (for PR11 / Colab).

Needs neither pydicom, the ChildBEx backend nor its database.
`CloudArtifact.open()` validates the completion marker, the manifest schema
and `artifactSha256`, the exact file set, and every shard (header and
SHA-256). Iteration is deterministic (manifest order) and verifies each
sample's tensor SHA-256; it never shuffles (PR11 owns seeded shuffling).
"""

from __future__ import annotations

import json
import os
import stat
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .errors import CloudArtifactError
from .manifest import (
    ARTIFACT_SCHEMA_VERSION,
    KIND,
    MANIFEST_FILE,
    MARKER_FILE,
    README_FILE,
    SPLITS,
    TENSOR_DIR,
    artifact_sha256,
    validate_manifest,
)
from .npy import file_sha256, open_shard, tensor_sha256

MARKER_KEYS = {"artifactSchemaVersion", "kind", "artifactSha256", "sampleCount", "shardCount", "totalTensorBytes", "containsDicom", "createdAt"}


@dataclass(frozen=True)
class CloudSample:
    tensor: np.ndarray = field(repr=False)  # (H, W, 3) float32 in [0, 1]
    label: str
    label_index: int
    split: str
    patient_token: str
    sample_token: str


def _lstat_regular(path: Path, missing: str = "ARTIFACT_FILE_MISSING") -> None:
    try:
        info = os.lstat(path)
    except OSError:
        raise CloudArtifactError(missing) from None
    if not stat.S_ISREG(info.st_mode):
        raise CloudArtifactError("ARTIFACT_FILE_NOT_REGULAR")


def _read_json(path: Path, missing: str, invalid: str) -> dict:
    _lstat_regular(path, missing)
    try:
        value = json.loads(path.read_bytes().decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        raise CloudArtifactError(invalid) from None
    if not isinstance(value, dict):
        raise CloudArtifactError(invalid)
    return value


def check_file_set(root: Path, manifest: dict) -> None:
    """Exactly manifest.json, the marker, the README and the manifest's shards."""
    expected_top = {MANIFEST_FILE, MARKER_FILE, README_FILE, TENSOR_DIR}
    unexpected = 0
    with os.scandir(root) as entries:
        names = set()
        for entry in entries:
            names.add(entry.name)
            if entry.name not in expected_top:
                unexpected += 1
            elif entry.is_symlink():
                raise CloudArtifactError("ARTIFACT_FILE_NOT_REGULAR")
    if unexpected:
        raise CloudArtifactError("UNEXPECTED_ARTIFACT_FILE", count=unexpected)
    if expected_top - names:
        raise CloudArtifactError("ARTIFACT_FILE_MISSING")
    _lstat_regular(root / README_FILE)
    tensor_dir = root / TENSOR_DIR
    info = os.lstat(tensor_dir)
    if not stat.S_ISDIR(info.st_mode):
        raise CloudArtifactError("ARTIFACT_FILE_NOT_REGULAR")
    expected = {shard["file"].split("/", 1)[1] for shard in manifest["shards"]}
    seen = set()
    with os.scandir(tensor_dir) as entries:
        for entry in entries:
            if entry.name not in expected:
                unexpected += 1
                continue
            seen.add(entry.name)
            if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                raise CloudArtifactError("ARTIFACT_FILE_NOT_REGULAR")
    if unexpected:
        raise CloudArtifactError("UNEXPECTED_ARTIFACT_FILE", count=unexpected)
    if expected - seen:
        raise CloudArtifactError("ARTIFACT_FILE_MISSING", count=len(expected - seen))


def _validate_marker(marker: dict, manifest: dict, sha: str) -> None:
    if set(marker) != MARKER_KEYS or marker["artifactSchemaVersion"] != ARTIFACT_SCHEMA_VERSION or marker["kind"] != KIND:
        raise CloudArtifactError("ARTIFACT_INCOMPLETE", detail="marker")
    if marker["containsDicom"] is not False:
        raise CloudArtifactError("ARTIFACT_INCOMPLETE", detail="marker")
    if marker["artifactSha256"] != sha:
        raise CloudArtifactError("ARTIFACT_HASH_MISMATCH")
    height, width, channels = manifest["tensor"]["shape"]
    if (
        marker["sampleCount"] != len(manifest["samples"])
        or marker["shardCount"] != len(manifest["shards"])
        or marker["totalTensorBytes"] != len(manifest["samples"]) * height * width * channels * 4
    ):
        raise CloudArtifactError("ARTIFACT_MARKER_MISMATCH")


class CloudArtifact:
    def __init__(self, root: Path, manifest: dict, marker: dict, sha: str):
        self.root = root
        self.manifest = manifest
        self.marker = marker
        self.artifact_sha256 = sha
        self.height, self.width, _ = manifest["tensor"]["shape"]
        self.label_encoding = dict(manifest["labelEncoding"])
        self._shards = {shard["file"]: shard for shard in manifest["shards"]}

    @classmethod
    def open(cls, root: str | os.PathLike, *, verify_shards: bool = True) -> "CloudArtifact":
        root = Path(root)
        if not root.is_dir():
            raise CloudArtifactError("ARTIFACT_INCOMPLETE", detail="root is not a directory")
        marker = _read_json(root / MARKER_FILE, "ARTIFACT_INCOMPLETE", "ARTIFACT_INCOMPLETE")
        manifest = validate_manifest(_read_json(root / MANIFEST_FILE, "ARTIFACT_INCOMPLETE", "INVALID_ARTIFACT_MANIFEST"))
        sha = artifact_sha256(manifest)
        _validate_marker(marker, manifest, sha)
        check_file_set(root, manifest)
        artifact = cls(root, manifest, marker, sha)
        for shard in manifest["shards"]:
            artifact._open_shard(shard)  # header, dtype, shape, size
            if verify_shards and file_sha256(root / shard["file"]) != shard["sha256"]:
                raise CloudArtifactError("SHARD_HASH_MISMATCH", detail=shard["file"])
        return artifact

    def _open_shard(self, shard: dict) -> np.ndarray:
        return open_shard(self.root / shard["file"], shard["count"], self.height, self.width)

    def count(self, split: str) -> int:
        return self.manifest["counts"][self._split(split)]["samples"]

    @staticmethod
    def _split(split: str) -> str:
        if split not in SPLITS:
            raise ValueError(f"split must be one of {', '.join(SPLITS)}")
        return split

    def iter_split(self, split: str) -> Iterator[CloudSample]:
        """Samples of one split in manifest order; raises on the first hash
        mismatch (nothing is skipped)."""
        split = self._split(split)
        samples = [sample for sample in self.manifest["samples"] if sample["split"] == split]
        return self._iterate(samples)

    def _iterate(self, samples: list[dict]) -> Iterator[CloudSample]:
        current_file, current = None, None
        for sample in samples:
            if sample["shard"] != current_file:
                current_file, current = sample["shard"], self._open_shard(self._shards[sample["shard"]])
            tensor = np.array(current[sample["index"]], dtype=np.float32, copy=True)
            if tensor_sha256(tensor) != sample["tensorSha256"]:
                raise CloudArtifactError("TENSOR_HASH_MISMATCH", detail=sample["sampleToken"])
            yield CloudSample(
                tensor=tensor,
                label=sample["label"],
                label_index=sample["labelIndex"],
                split=sample["split"],
                patient_token=sample["patientToken"],
                sample_token=sample["sampleToken"],
            )

    def verify(self) -> dict:
        """Full verification: shard hashes (open) and every tensor hash."""
        verified = 0
        for split in SPLITS:
            for _ in self.iter_split(split):
                verified += 1
        return {"artifactSha256": self.artifact_sha256, "verifiedSamples": verified, "shards": len(self.manifest["shards"])}
