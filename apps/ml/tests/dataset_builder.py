"""Synthetic snapshot exports, written exactly as the backend writes them
(canonical manifest.json, EXPORT_COMPLETE.json, dicom/<uuid>.dcm).

Default dataset: 6 patients / 9 items. P1 has mixed labels; quotas
TRAIN 4 patients, VALIDATION 1, TEST 1.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np

from childbex_ml.canonical import canonical_json
from childbex_ml.dataset.manifest import canonical_manifest
from synthetic import ct_bytes

SNAPSHOT_ID = "dddddddd-dddd-4ddd-8ddd-000000000042"


def uid(group: str, n: int) -> str:
    return f"{group * 8}-{group * 4}-4{group * 3}-8{group * 3}-{n:012d}"


def patient_key(p: int) -> str:
    return uid("1", p)


# (n, patient, split, label, dicom kwargs)
DEFAULT_ITEMS = [
    (1, 1, "TRAIN", "NORMAL", {}),
    (2, 1, "TRAIN", "NORMAL", {}),
    (3, 1, "TRAIN", "ABNORMAL", {}),
    (4, 2, "TRAIN", "NORMAL", {}),
    (5, 3, "TRAIN", "ABNORMAL", {}),
    (6, 3, "TRAIN", "ABNORMAL", {}),
    (7, 4, "TRAIN", "NORMAL", {}),
    (8, 5, "VALIDATION", "NORMAL", {}),
    (9, 6, "TEST", "ABNORMAL", {}),
]


def dicom_for(n: int, **kwargs) -> bytes:
    stored = np.full((16, 16), 1024 + 40 + n, dtype=np.int16)
    stored[0, 0] = 1024 + 1000  # asymmetric marker
    return ct_bytes(stored, **kwargs)


def build_manifest(items=DEFAULT_ITEMS) -> tuple[dict, dict[str, bytes]]:
    files: dict[str, bytes] = {}
    manifest_items = []
    per_patient: dict[int, Counter] = {}
    split_of: dict[int, str] = {}
    order: Counter = Counter()
    for n, patient, split, label, kwargs in items:
        data = dicom_for(n, **kwargs)
        image_id = uid("3", n)
        files[image_id] = data
        per_patient.setdefault(patient, Counter())[label] += 1
        split_of[patient] = split
        manifest_items.append(
            {
                "patientImageId": image_id,
                "patientGroupKey": patient_key(patient),
                "patientId": patient_key(patient),
                "studyId": uid("4", patient),
                "seriesId": uid("5", patient),
                "split": split,
                "label": label,
                "reviewStateAtSnapshot": label,
                "reviewStateSourceAtSnapshot": "VOTES",
                "seriesOrderIndex": order[patient] * 2 + 1,
                "fileSha256": hashlib.sha256(data).hexdigest(),
                "fileSize": len(data),
            }
        )
        order[patient] += 1
    patients = []
    for patient, counts in per_patient.items():
        normal, abnormal = counts["NORMAL"], counts["ABNORMAL"]
        patients.append(
            {
                "patientGroupKey": patient_key(patient),
                "patientId": patient_key(patient),
                "split": split_of[patient],
                "stratum": "MIXED" if normal and abnormal else "NORMAL_ONLY" if normal else "ABNORMAL_ONLY",
                "imageCount": normal + abnormal,
                "normalImages": normal,
                "abnormalImages": abnormal,
            }
        )
    labels = Counter(item["label"] for item in manifest_items)
    manifest = {
        "manifestSchemaVersion": 1,
        "snapshot": {
            "id": SNAPSHOT_ID,
            "datasetSchemaVersion": 1,
            "datasetConfiguration": {"datasetSchemaVersion": 1, "split": {"train": 0.7, "validation": 0.15, "test": 0.15, "seed": "s"}},
            "splitSeed": "s",
            "finalizedAt": "2026-10-01T08:00:00.000Z",
            "reviewFreezeId": uid("e", 1),
            "fileVerification": "SHA256_REHASHED",
            "totalPatients": len(patients),
            "totalImages": len(manifest_items),
            "normalImages": labels["NORMAL"],
            "abnormalImages": labels["ABNORMAL"],
        },
        "patients": patients,
        "items": manifest_items,
    }
    return manifest, files


def write_manifest(root: Path, manifest: dict, *, status: str = "FINALIZED", marker_overrides: dict | None = None) -> str:
    text = canonical_json(canonical_manifest(manifest))
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    (root / "manifest.json").write_text(text, "utf-8")
    marker = {
        "exportFormatVersion": 1,
        "manifestSchemaVersion": 1,
        "snapshotId": manifest["snapshot"]["id"],
        "manifestSha256": digest,
        "snapshotStatusAtExport": status,
        "itemCount": len(manifest["items"]),
        "totalBytes": sum(item["fileSize"] for item in manifest["items"]),
        "exportedAt": "2026-10-01T09:00:00.000Z",
        "sensitive": True,
        "deidentified": False,
    }
    marker.update(marker_overrides or {})
    (root / "EXPORT_COMPLETE.json").write_text(json.dumps(marker, indent=2) + "\n", "utf-8")
    return digest


def build_export(root: Path, items=DEFAULT_ITEMS, *, status: str = "FINALIZED") -> dict:
    root.mkdir(parents=True, exist_ok=True)
    manifest, files = build_manifest(items)
    (root / "dicom").mkdir()
    for image_id, data in files.items():
        (root / "dicom" / f"{image_id}.dcm").write_bytes(data)
    digest = write_manifest(root, manifest, status=status)
    return {"root": root, "manifest": manifest, "files": files, "sha256": digest}


def rewrite_manifest(root: Path, mutate) -> str:
    """Mutates manifest.json and re-seals the marker (tests target the
    validation rules, not the hash check)."""
    manifest = json.loads((root / "manifest.json").read_text("utf-8"))
    mutate(manifest)
    return write_manifest(root, manifest)
