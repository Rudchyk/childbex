"""Snapshot preprocessing preflight.

Every item of a completed export is verified and preprocessed with an
explicit PR9 configuration; item failures are collected (never skipped,
never fail-fast). The report is bound to the snapshot, the manifest hash,
the preprocessing configuration hash and the ML runtime:

    preflightIdentity = SHA-256(canonical JSON of {preflightSchemaVersion,
        snapshotId, manifestSha256, preprocessingConfigHash, runtime})

where runtime = {childbexMlVersion, pythonImplementation, pythonVersion,
numpyVersion, pydicomVersion}. Timestamps are recorded but not part of the
identity.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from ..canonical import hash_canonical
from ..preprocessing import PreprocessingError, config_hash, preprocess_dicom_bytes, resolve_config
from ..preprocessing.config import SCHEMA_VERSION as PREPROCESSING_SCHEMA_VERSION
from .errors import DatasetError
from .export import PREFLIGHT_DIR, SnapshotExport, open_export
from .items import Preprocess, process_item
from .manifest import SPLITS
from .runtime import runtime_fingerprint

PREFLIGHT_SCHEMA_VERSION = 1

# Explicit, versioned numeric label encoding (part of every report and sample).
LABEL_ENCODING_V1 = {"NORMAL": 0, "ABNORMAL": 1}


def preflight_identity(snapshot_id: str, manifest_sha256: str, preprocessing_config_hash: str, runtime: dict) -> str:
    return hash_canonical(
        {
            "preflightSchemaVersion": PREFLIGHT_SCHEMA_VERSION,
            "snapshotId": snapshot_id,
            "manifestSha256": manifest_sha256,
            "preprocessingConfigHash": preprocessing_config_hash,
            "runtime": runtime,
        }
    )


def report_path(root: Path, preprocessing_config_hash: str, report_dir: str | os.PathLike | None = None) -> Path:
    return Path(report_dir if report_dir is not None else Path(root) / PREFLIGHT_DIR) / f"{preprocessing_config_hash}.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(prefix=".preflight-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    except BaseException:
        if os.path.exists(temp):
            os.unlink(temp)
        raise


def scan(export: SnapshotExport, config: dict, preprocess: Preprocess = preprocess_dicom_bytes) -> dict:
    """Processes every item; returns counts and all failures (no report I/O)."""
    by_split = {split: {"items": 0, "passed": 0, "failed": 0} for split in SPLITS}
    failures = []
    for item in export.manifest.items:
        by_split[item.split]["items"] += 1
        try:
            process_item(export.dicom_path(item.patient_image_id), item, config, preprocess)
        except (DatasetError, PreprocessingError) as error:
            failures.append({"patientImageId": item.patient_image_id, "split": item.split, "code": error.code})
            by_split[item.split]["failed"] += 1
        else:
            by_split[item.split]["passed"] += 1
    return {"bySplit": by_split, "failures": failures}


def run_preflight(
    root: str | os.PathLike,
    config: dict,
    *,
    report_dir: str | os.PathLike | None = None,
    preprocess: Preprocess = preprocess_dicom_bytes,
) -> dict:
    """Validates the export (folder-level errors raise DatasetError before
    any item is processed), scans every item, writes and returns the report."""
    resolved = resolve_config(config)
    preprocessing_hash = config_hash(resolved)
    started = _now()
    export = open_export(root)
    runtime = runtime_fingerprint()
    result = scan(export, resolved, preprocess)
    failures = result["failures"]
    total = len(export.manifest.items)
    report = {
        "preflightSchemaVersion": PREFLIGHT_SCHEMA_VERSION,
        "preflightIdentity": preflight_identity(export.manifest.snapshot_id, export.manifest.sha256, preprocessing_hash, runtime),
        "ok": not failures and total > 0,
        "snapshotId": export.manifest.snapshot_id,
        "manifestSha256": export.manifest.sha256,
        "preprocessing": {
            "schemaVersion": PREPROCESSING_SCHEMA_VERSION,
            "configHash": preprocessing_hash,
            "config": resolved,
        },
        "runtime": runtime,
        "labelEncoding": dict(LABEL_ENCODING_V1),
        "totalItems": total,
        "passedItems": total - len(failures),
        "failedItems": len(failures),
        "bySplit": result["bySplit"],
        "failuresByCode": dict(sorted(Counter(f["code"] for f in failures).items())),
        "failures": failures,
        "startedAt": started,
        "finishedAt": _now(),
    }
    _write_atomic(report_path(export.root, preprocessing_hash, report_dir), report)
    return report
