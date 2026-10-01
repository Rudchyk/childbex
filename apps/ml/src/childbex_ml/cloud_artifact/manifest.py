"""Cloud artifact manifest, schema version 1 (`CHILDBEX_CT_SLICE_TENSORS_V1`).

Only what external 2D training needs: artifact-scoped patient and sample
tokens, split, label, shard position and tensor hash, plus the source and
preprocessing provenance hashes. No ChildBEx identifiers, no snapshot id, no
series / study / slice order, no DICOM metadata.

NumPy-free and pydicom-free: the PR11 reader imports only this, `npy.py`
and `childbex_ml.canonical`.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from ..canonical import CanonicalJsonError, hash_canonical
from .errors import CloudArtifactError

ARTIFACT_SCHEMA_VERSION = 1
KIND = "CHILDBEX_CT_SLICE_TENSORS_V1"
SPLITS = ("TRAIN", "VALIDATION", "TEST")
LABEL_ENCODING = {"NORMAL": 0, "ABNORMAL": 1}
PRIVACY = {
    "containsDicom": False,
    "dicomMetadata": "NONE",
    "pixelContent": "PRESENT",
    "classification": "PSEUDONYMOUS_PRIVACY_MINIMIZED",
    "pixelGate": "PIXEL_GATE_V1",
    "attestationVerified": True,
}
RUNTIME_KEYS = {"childbexMlVersion", "pythonImplementation", "pythonVersion", "numpyVersion", "pydicomVersion"}

SHA256 = re.compile(r"^[0-9a-f]{64}$")
PATIENT_TOKEN = re.compile(r"^p[0-9]{5,}$")
SAMPLE_TOKEN = re.compile(r"^s[0-9]{6,}$")
SHARD_FILE = re.compile(r"^tensors/(TRAIN|VALIDATION|TEST)-([0-9]{5})\.npy$")

MANIFEST_FILE = "manifest.json"
MARKER_FILE = "CLOUD_ARTIFACT_COMPLETE.json"
README_FILE = "README-SENSITIVE.txt"
TENSOR_DIR = "tensors"


def patient_token(n: int) -> str:
    return f"p{n:05d}"


def sample_token(n: int) -> str:
    return f"s{n:06d}"


def shard_file(split: str, n: int) -> str:
    return f"{TENSOR_DIR}/{split}-{n:05d}.npy"


def artifact_sha256(manifest: dict) -> str:
    """SHA-256 of the canonical JSON of the manifest (= SHA-256 of manifest.json)."""
    try:
        return hash_canonical(manifest)
    except CanonicalJsonError:
        raise CloudArtifactError("INVALID_ARTIFACT_MANIFEST", detail="not canonically serializable") from None


def _invalid(where: str) -> CloudArtifactError:
    return CloudArtifactError("INVALID_ARTIFACT_MANIFEST", detail=where)


def _exact(value: Any, keys: set[str], where: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise _invalid(where)
    return value


def _int(value: Any, where: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise _invalid(where)
    return value


def _sha(value: Any, where: str) -> str:
    if not isinstance(value, str) or not SHA256.match(value):
        raise _invalid(where)
    return value


def validate_manifest(manifest: Any) -> dict:
    """Schema, tokens, shard layout, split integrity and counts. Returns the
    manifest unchanged (it is already in canonical order)."""
    _exact(
        manifest,
        {"artifactSchemaVersion", "kind", "privacy", "source", "preprocessing", "producedBy",
         "labelEncoding", "tensor", "counts", "patients", "shards", "samples"},
        "manifest",
    )
    if isinstance(manifest["artifactSchemaVersion"], bool) or manifest["artifactSchemaVersion"] != ARTIFACT_SCHEMA_VERSION:
        raise _invalid("artifactSchemaVersion")
    if manifest["kind"] != KIND:
        raise _invalid("kind")
    if manifest["privacy"] != PRIVACY or any(type(manifest["privacy"][k]) is not type(v) for k, v in PRIVACY.items()):
        raise _invalid("privacy")
    source = _exact(manifest["source"], {"manifestSha256", "preflightIdentity"}, "source")
    _sha(source["manifestSha256"], "source.manifestSha256")
    _sha(source["preflightIdentity"], "source.preflightIdentity")
    preprocessing = _exact(manifest["preprocessing"], {"schemaVersion", "configHash", "config"}, "preprocessing")
    if preprocessing["schemaVersion"] != 1 or not isinstance(preprocessing["config"], dict):
        raise _invalid("preprocessing")
    if _sha(preprocessing["configHash"], "preprocessing.configHash") != hash_canonical(preprocessing["config"]):
        raise _invalid("preprocessing.configHash")
    produced = _exact(manifest["producedBy"], RUNTIME_KEYS, "producedBy")
    if not all(isinstance(value, str) and value for value in produced.values()):
        raise _invalid("producedBy")
    if manifest["labelEncoding"] != LABEL_ENCODING:
        raise _invalid("labelEncoding")
    tensor = _exact(manifest["tensor"], {"shape", "dtype", "byteOrder", "layout"}, "tensor")
    try:
        resize = preprocessing["config"]["resize"]
        expected_shape = [resize["height"], resize["width"], 3]
    except (KeyError, TypeError):
        raise _invalid("preprocessing.config") from None
    if (
        tensor["shape"] != expected_shape
        or not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in tensor["shape"])
        or tensor["dtype"] != "float32"
        or tensor["byteOrder"] != "little"
        or tensor["layout"] != "HWC"
    ):
        raise _invalid("tensor")

    # Patients.
    if not isinstance(manifest["patients"], list) or not manifest["patients"]:
        raise _invalid("patients")
    patient_split: dict[str, str] = {}
    for index, patient in enumerate(manifest["patients"]):
        where = f"patients[{index}]"
        _exact(patient, {"patientToken", "split"}, where)
        token = patient["patientToken"]
        if not isinstance(token, str) or not PATIENT_TOKEN.match(token) or patient["split"] not in SPLITS:
            raise _invalid(where)
        if token in patient_split:
            raise CloudArtifactError("SPLIT_INTEGRITY_ERROR", detail="a patient token appears more than once")
        patient_split[token] = patient["split"]

    # Shards.
    if not isinstance(manifest["shards"], list) or not manifest["shards"]:
        raise _invalid("shards")
    shards: dict[str, dict] = {}
    per_split_numbers: dict[str, list[int]] = defaultdict(list)
    for index, shard in enumerate(manifest["shards"]):
        where = f"shards[{index}]"
        _exact(shard, {"file", "split", "count", "sha256"}, where)
        match = SHARD_FILE.match(shard["file"]) if isinstance(shard["file"], str) else None
        if not match or match.group(1) != shard["split"]:
            raise _invalid(f"{where}.file")
        _int(shard["count"], f"{where}.count", minimum=1)
        _sha(shard["sha256"], f"{where}.sha256")
        if shard["file"] in shards:
            raise CloudArtifactError("DUPLICATE_SAMPLE", detail="shard file")
        shards[shard["file"]] = shard
        per_split_numbers[shard["split"]].append(int(match.group(2)))
    for numbers in per_split_numbers.values():
        if numbers != list(range(len(numbers))):
            raise _invalid("shards numbering")

    # Samples.
    if not isinstance(manifest["samples"], list):
        raise _invalid("samples")
    seen_tokens: set[str] = set()
    positions: dict[str, list[int]] = defaultdict(list)
    counts: dict[str, Counter] = {split: Counter() for split in SPLITS}
    patients_with_samples: set[str] = set()
    for index, sample in enumerate(manifest["samples"]):
        where = f"samples[{index}]"
        _exact(sample, {"sampleToken", "patientToken", "split", "label", "labelIndex", "shard", "index", "tensorSha256"}, where)
        if not isinstance(sample["sampleToken"], str) or not SAMPLE_TOKEN.match(sample["sampleToken"]):
            raise _invalid(f"{where}.sampleToken")
        if sample["sampleToken"] in seen_tokens:
            raise CloudArtifactError("DUPLICATE_SAMPLE", detail="sampleToken")
        seen_tokens.add(sample["sampleToken"])
        if sample["split"] not in SPLITS or sample["label"] not in LABEL_ENCODING:
            raise _invalid(where)
        if isinstance(sample["labelIndex"], bool) or sample["labelIndex"] != LABEL_ENCODING[sample["label"]]:
            raise _invalid(f"{where}.labelIndex")
        _sha(sample["tensorSha256"], f"{where}.tensorSha256")
        split = patient_split.get(sample["patientToken"])
        if split is None:
            raise CloudArtifactError("SPLIT_INTEGRITY_ERROR", detail="a sample references an unknown patient token")
        if sample["split"] != split:
            raise CloudArtifactError("SPLIT_INTEGRITY_ERROR", detail="a sample split differs from its patient split")
        shard = shards.get(sample["shard"])
        if shard is None or shard["split"] != sample["split"]:
            raise _invalid(f"{where}.shard")
        positions[sample["shard"]].append(_int(sample["index"], f"{where}.index"))
        counts[sample["split"]]["samples"] += 1
        counts[sample["split"]][sample["label"]] += 1
        patients_with_samples.add(sample["patientToken"])
    for file, shard in shards.items():
        if positions[file] != list(range(shard["count"])):
            raise CloudArtifactError("DUPLICATE_SAMPLE", detail="shard positions")
    if patients_with_samples != set(patient_split):
        raise CloudArtifactError("COUNT_MISMATCH", detail="patients without samples")

    # Counts.
    expected_counts = {
        split: {
            "patients": sum(1 for s in patient_split.values() if s == split),
            "samples": counts[split]["samples"],
            "NORMAL": counts[split]["NORMAL"],
            "ABNORMAL": counts[split]["ABNORMAL"],
        }
        for split in SPLITS
    }
    if manifest["counts"] != expected_counts:
        raise CloudArtifactError("COUNT_MISMATCH", detail="counts")
    return manifest
