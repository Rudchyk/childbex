"""Dataset export manifest schema version 1: validation, canonical order and
hash.

The manifest is written by the Node backend
(`node migrate.js dataset-snapshot export`) and never trusted blindly: every
field, every cross-reference and every count is checked here again.
"""

from __future__ import annotations

import copy
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from ..canonical import CanonicalJsonError, hash_canonical
from .errors import DatasetError

MANIFEST_SCHEMA_VERSION = 1
DATASET_SCHEMA_VERSION = 1
SPLITS = ("TRAIN", "VALIDATION", "TEST")
LABELS = ("NORMAL", "ABNORMAL")
STRATA = ("NORMAL_ONLY", "ABNORMAL_ONLY", "MIXED")
REVIEW_SOURCES = ("VOTES", "RESOLUTION", "FINISH_REVIEW")

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")

SNAPSHOT_KEYS = {
    "id",
    "datasetSchemaVersion",
    "datasetConfiguration",
    "splitSeed",
    "finalizedAt",
    "reviewFreezeId",
    "fileVerification",
    "totalPatients",
    "totalImages",
    "normalImages",
    "abnormalImages",
}
PATIENT_KEYS = {"patientGroupKey", "patientId", "split", "stratum", "imageCount", "normalImages", "abnormalImages"}
ITEM_KEYS = {
    "patientImageId",
    "patientGroupKey",
    "patientId",
    "studyId",
    "seriesId",
    "split",
    "label",
    "reviewStateAtSnapshot",
    "reviewStateSourceAtSnapshot",
    "seriesOrderIndex",
    "fileSha256",
    "fileSize",
}


@dataclass(frozen=True)
class ManifestPatient:
    patient_group_key: str
    patient_id: str
    split: str
    stratum: str
    image_count: int
    normal_images: int
    abnormal_images: int


@dataclass(frozen=True)
class ManifestItem:
    patient_image_id: str
    patient_group_key: str
    patient_id: str
    study_id: str
    series_id: str
    split: str
    label: str
    review_state_at_snapshot: str
    review_state_source_at_snapshot: str
    series_order_index: int
    file_sha256: str
    file_size: int


@dataclass(frozen=True)
class Manifest:
    snapshot_id: str
    snapshot: dict
    patients: tuple[ManifestPatient, ...]  # canonical order
    items: tuple[ManifestItem, ...]  # canonical order
    sha256: str


# --- canonical order and hash -------------------------------------------------------


def _split_rank(split: Any) -> int:
    return SPLITS.index(split) if split in SPLITS else len(SPLITS)


def patient_sort_key(patient: dict) -> tuple:
    """split (TRAIN, VALIDATION, TEST), patientGroupKey."""
    return (_split_rank(patient.get("split")), str(patient.get("patientGroupKey")))


def item_sort_key(item: dict) -> tuple:
    """split, patientGroupKey, seriesId, seriesOrderIndex, patientImageId."""
    index = item.get("seriesOrderIndex")
    return (
        _split_rank(item.get("split")),
        str(item.get("patientGroupKey")),
        str(item.get("seriesId")),
        index if isinstance(index, int) and not isinstance(index, bool) else -1,
        str(item.get("patientImageId")),
    )


def canonical_manifest(raw: dict) -> dict:
    """A copy with `patients` and `items` in canonical order."""
    manifest = copy.deepcopy(raw)
    if isinstance(manifest.get("patients"), list) and all(isinstance(p, dict) for p in manifest["patients"]):
        manifest["patients"].sort(key=patient_sort_key)
    if isinstance(manifest.get("items"), list) and all(isinstance(i, dict) for i in manifest["items"]):
        manifest["items"].sort(key=item_sort_key)
    return manifest


def manifest_sha256(raw: dict) -> str:
    """SHA-256 of the canonical JSON of the canonically ordered manifest
    (equal to the SHA-256 of manifest.json as the backend writes it)."""
    try:
        return hash_canonical(canonical_manifest(raw))
    except CanonicalJsonError:
        raise DatasetError("INVALID_MANIFEST", detail="not canonically serializable") from None


# --- parsing ----------------------------------------------------------------------------


def _reject_duplicate_keys(pairs):
    keys = [key for key, _ in pairs]
    if len(keys) != len(set(keys)):
        raise DatasetError("INVALID_MANIFEST", detail="duplicate JSON key")
    return dict(pairs)


def parse_manifest_bytes(data: bytes) -> dict:
    try:
        raw = json.loads(data.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except DatasetError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise DatasetError("INVALID_MANIFEST", detail="not UTF-8 JSON") from None
    if not isinstance(raw, dict):
        raise DatasetError("INVALID_MANIFEST", detail="manifest")
    return raw


# --- schema -------------------------------------------------------------------------------


def _invalid(where: str) -> DatasetError:
    return DatasetError("INVALID_MANIFEST", detail=where)


def _exact_keys(value: Any, keys: set[str], where: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise _invalid(where)
    return value


def _int(value: Any, where: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise _invalid(where)
    return value


def _uuid(value: Any, where: str) -> str:
    if not isinstance(value, str) or not UUID.match(value):
        raise _invalid(where)
    return value


def _enum(value: Any, allowed: tuple[str, ...], where: str) -> str:
    if value not in allowed or not isinstance(value, str):
        raise _invalid(where)
    return value


def _group_key(value: Any, where: str) -> str:
    if not isinstance(value, str) or not 0 < len(value) <= 128:
        raise _invalid(where)
    return value


def _validate_schema(raw: dict) -> tuple[dict, list[ManifestPatient], list[ManifestItem]]:
    _exact_keys(raw, {"manifestSchemaVersion", "snapshot", "patients", "items"}, "manifest")
    version = raw["manifestSchemaVersion"]
    if isinstance(version, bool) or version != MANIFEST_SCHEMA_VERSION:
        raise _invalid("manifestSchemaVersion")

    snapshot = _exact_keys(raw["snapshot"], SNAPSHOT_KEYS, "snapshot")
    _uuid(snapshot["id"], "snapshot.id")
    if isinstance(snapshot["datasetSchemaVersion"], bool) or snapshot["datasetSchemaVersion"] != DATASET_SCHEMA_VERSION:
        raise _invalid("snapshot.datasetSchemaVersion")
    if not isinstance(snapshot["datasetConfiguration"], dict):
        raise _invalid("snapshot.datasetConfiguration")
    if not isinstance(snapshot["splitSeed"], str) or not snapshot["splitSeed"]:
        raise _invalid("snapshot.splitSeed")
    if not isinstance(snapshot["finalizedAt"], str) or not snapshot["finalizedAt"]:
        # Only a finalized snapshot has membership.
        raise DatasetError("SNAPSHOT_NOT_FINALIZED")
    if snapshot["reviewFreezeId"] is not None:
        _uuid(snapshot["reviewFreezeId"], "snapshot.reviewFreezeId")
    if snapshot["fileVerification"] != "SHA256_REHASHED":
        raise _invalid("snapshot.fileVerification")
    for key in ("totalPatients", "totalImages", "normalImages", "abnormalImages"):
        _int(snapshot[key], f"snapshot.{key}")

    if not isinstance(raw["patients"], list):
        raise _invalid("patients")
    patients = []
    for index, value in enumerate(raw["patients"]):
        where = f"patients[{index}]"
        p = _exact_keys(value, PATIENT_KEYS, where)
        patients.append(
            ManifestPatient(
                patient_group_key=_group_key(p["patientGroupKey"], f"{where}.patientGroupKey"),
                patient_id=_uuid(p["patientId"], f"{where}.patientId"),
                split=_enum(p["split"], SPLITS, f"{where}.split"),
                stratum=_enum(p["stratum"], STRATA, f"{where}.stratum"),
                image_count=_int(p["imageCount"], f"{where}.imageCount"),
                normal_images=_int(p["normalImages"], f"{where}.normalImages"),
                abnormal_images=_int(p["abnormalImages"], f"{where}.abnormalImages"),
            )
        )

    if not isinstance(raw["items"], list):
        raise _invalid("items")
    items = []
    for index, value in enumerate(raw["items"]):
        where = f"items[{index}]"
        i = _exact_keys(value, ITEM_KEYS, where)
        label = _enum(i["label"], LABELS, f"{where}.label")
        if i["reviewStateAtSnapshot"] != label:  # dataset schema v1
            raise _invalid(f"{where}.reviewStateAtSnapshot")
        if not isinstance(i["fileSha256"], str) or not SHA256.match(i["fileSha256"]):
            raise _invalid(f"{where}.fileSha256")
        items.append(
            ManifestItem(
                patient_image_id=_uuid(i["patientImageId"], f"{where}.patientImageId"),
                patient_group_key=_group_key(i["patientGroupKey"], f"{where}.patientGroupKey"),
                patient_id=_uuid(i["patientId"], f"{where}.patientId"),
                study_id=_uuid(i["studyId"], f"{where}.studyId"),
                series_id=_uuid(i["seriesId"], f"{where}.seriesId"),
                split=_enum(i["split"], SPLITS, f"{where}.split"),
                label=label,
                review_state_at_snapshot=label,
                review_state_source_at_snapshot=_enum(
                    i["reviewStateSourceAtSnapshot"], REVIEW_SOURCES, f"{where}.reviewStateSourceAtSnapshot"
                ),
                series_order_index=_int(i["seriesOrderIndex"], f"{where}.seriesOrderIndex"),
                file_sha256=i["fileSha256"],
                file_size=_int(i["fileSize"], f"{where}.fileSize", minimum=1),
            )
        )
    return snapshot, patients, items


# --- consistency ------------------------------------------------------------------------------


def _check_duplicates(items: list[ManifestItem]) -> None:
    ids = Counter(item.patient_image_id for item in items)
    if any(count > 1 for count in ids.values()):
        raise DatasetError("DUPLICATE_ITEM", detail="patientImageId")
    positions = Counter((item.series_id, item.series_order_index) for item in items)
    if any(count > 1 for count in positions.values()):
        raise DatasetError("DUPLICATE_ITEM", detail="seriesId + seriesOrderIndex")


def _check_split_integrity(patients: list[ManifestPatient], items: list[ManifestItem]) -> None:
    def fail(detail: str):
        raise DatasetError("SNAPSHOT_SPLIT_INTEGRITY_ERROR", detail=detail)

    by_key: dict[str, ManifestPatient] = {}
    for patient in patients:
        if patient.patient_group_key in by_key:
            fail("a patientGroupKey has more than one patient row / split")
        by_key[patient.patient_group_key] = patient
    if len({p.patient_id for p in patients}) != len(patients):
        fail("a patientId has more than one patientGroupKey")

    item_splits: dict[str, set[str]] = defaultdict(set)
    series_owner: dict[str, tuple[str, str]] = {}
    study_owner: dict[str, str] = {}
    for item in items:
        patient = by_key.get(item.patient_group_key)
        if patient is None:
            fail("an item references an unknown patientGroupKey")
        if item.split != patient.split:
            fail("an item split differs from its patient split")
        if item.patient_id != patient.patient_id:
            fail("an item patientId differs from its patient")
        item_splits[item.patient_group_key].add(item.split)
        owner = (item.study_id, item.patient_group_key)
        if series_owner.setdefault(item.series_id, owner) != owner:
            fail("a series belongs to more than one study or patient")
        if study_owner.setdefault(item.study_id, item.patient_group_key) != item.patient_group_key:
            fail("a study belongs to more than one patient")
    if any(len(splits) > 1 for splits in item_splits.values()):
        fail("a patient appears in more than one split")


def _check_counts(snapshot: dict, patients: list[ManifestPatient], items: list[ManifestItem]) -> None:
    def fail(detail: str):
        raise DatasetError("SNAPSHOT_COUNT_MISMATCH", detail=detail)

    labels = Counter(item.label for item in items)
    if len(items) != snapshot["totalImages"]:
        fail("totalImages")
    if len(patients) != snapshot["totalPatients"]:
        fail("totalPatients")
    if labels["NORMAL"] != snapshot["normalImages"] or labels["ABNORMAL"] != snapshot["abnormalImages"]:
        fail("label counts")
    per_patient: dict[str, Counter] = defaultdict(Counter)
    for item in items:
        per_patient[item.patient_group_key][item.label] += 1
    for patient in patients:
        counts = per_patient.get(patient.patient_group_key, Counter())
        normal, abnormal = counts["NORMAL"], counts["ABNORMAL"]
        if (
            patient.image_count == 0
            or patient.image_count != normal + abnormal
            or patient.normal_images != normal
            or patient.abnormal_images != abnormal
        ):
            fail("patient image counts")
        expected = "MIXED" if normal and abnormal else "NORMAL_ONLY" if normal else "ABNORMAL_ONLY"
        if patient.stratum != expected:
            fail("patient stratum")


def validate_manifest(raw: Any) -> Manifest:
    """Schema, then duplicates, then split integrity, then counts."""
    if not isinstance(raw, dict):
        raise _invalid("manifest")
    snapshot, patients, items = _validate_schema(raw)
    _check_duplicates(items)
    _check_split_integrity(patients, items)
    _check_counts(snapshot, patients, items)
    patients.sort(key=lambda p: (_split_rank(p.split), p.patient_group_key))
    items.sort(
        key=lambda i: (_split_rank(i.split), i.patient_group_key, i.series_id, i.series_order_index, i.patient_image_id)
    )
    return Manifest(
        snapshot_id=snapshot["id"],
        snapshot=copy.deepcopy(snapshot),
        patients=tuple(patients),
        items=tuple(items),
        sha256=manifest_sha256(raw),
    )
