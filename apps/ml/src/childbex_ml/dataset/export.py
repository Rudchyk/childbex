"""Opening a materialized snapshot export (format version 1):

    <root>/manifest.json         canonical manifest (schema v1)
    <root>/EXPORT_COMPLETE.json  completion marker (written last by the backend)
    <root>/dicom/<patientImageId>.dcm
    <root>/preflight/<preprocessingConfigHash>.json   (preflight reports)

Only paths relative to `root` exist; an export can be moved or copied as a
whole. `root/dicom` must contain exactly the manifest's files: nothing
missing, nothing extra, no symlinks, only regular files.
"""

from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from .errors import DatasetError
from .manifest import UUID, Manifest, parse_manifest_bytes, validate_manifest

EXPORT_FORMAT_VERSION = 1
MANIFEST_FILE = "manifest.json"
MARKER_FILE = "EXPORT_COMPLETE.json"
DICOM_DIR = "dicom"
PREFLIGHT_DIR = "preflight"
FINALIZED_STATUSES = ("FINALIZED", "ARCHIVED")

MARKER_KEYS = {
    "exportFormatVersion",
    "manifestSchemaVersion",
    "snapshotId",
    "manifestSha256",
    "snapshotStatusAtExport",
    "itemCount",
    "totalBytes",
    "exportedAt",
    "sensitive",
    "deidentified",
}


@dataclass(frozen=True)
class SnapshotExport:
    root: Path
    manifest: Manifest
    marker: dict

    def dicom_path(self, patient_image_id: str) -> Path:
        return dicom_path(self.root, patient_image_id)


def dicom_path(root: Path, patient_image_id: str) -> Path:
    """`root/dicom/<patientImageId>.dcm`; the id must be a canonical UUID."""
    if not UUID.match(patient_image_id):
        raise ValueError("patient_image_id must be a canonical lowercase UUID")
    return Path(root) / DICOM_DIR / f"{patient_image_id}.dcm"


def _read_regular_file(path: Path, missing_code: str) -> bytes:
    try:
        info = os.lstat(path)
    except OSError:
        raise DatasetError(missing_code) from None
    if not stat.S_ISREG(info.st_mode):
        raise DatasetError(missing_code, detail="not a regular file")
    try:
        return path.read_bytes()
    except OSError:
        raise DatasetError(missing_code) from None


def _validate_marker(data: bytes) -> dict:
    try:
        marker = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise DatasetError("EXPORT_INCOMPLETE", detail="marker is not JSON") from None
    if not isinstance(marker, dict) or set(marker) != MARKER_KEYS:
        raise DatasetError("EXPORT_INCOMPLETE", detail="marker keys")
    if marker["exportFormatVersion"] != EXPORT_FORMAT_VERSION or marker["manifestSchemaVersion"] != 1:
        raise DatasetError("EXPORT_INCOMPLETE", detail="unsupported export format")
    if marker["snapshotStatusAtExport"] not in FINALIZED_STATUSES:
        raise DatasetError("SNAPSHOT_NOT_FINALIZED")
    if not isinstance(marker["manifestSha256"], str) or not isinstance(marker["snapshotId"], str):
        raise DatasetError("EXPORT_INCOMPLETE", detail="marker values")
    for key in ("itemCount", "totalBytes"):
        if isinstance(marker[key], bool) or not isinstance(marker[key], int):
            raise DatasetError("EXPORT_INCOMPLETE", detail="marker values")
    return marker


def check_file_set(root: Path, manifest: Manifest) -> None:
    """root/dicom must hold exactly dicom/<patientImageId>.dcm per item, all
    regular files. Unexpected names are counted, never reported (they could
    be anything)."""
    directory = Path(root) / DICOM_DIR
    try:
        info = os.lstat(directory)
    except OSError:
        info = None
    if info is None or not stat.S_ISDIR(info.st_mode):
        raise DatasetError("EXPORT_INCOMPLETE", detail="dicom directory")
    expected = {f"{item.patient_image_id}.dcm": item.patient_image_id for item in manifest.items}
    seen: set[str] = set()
    unexpected = 0
    not_regular: list[dict] = []
    with os.scandir(directory) as entries:
        for entry in entries:
            if entry.name not in expected:
                unexpected += 1
                continue
            seen.add(entry.name)
            if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                not_regular.append({"patientImageId": expected[entry.name], "code": "EXPORT_FILE_NOT_REGULAR"})
    if unexpected:
        raise DatasetError("UNEXPECTED_EXPORT_FILE", count=unexpected)
    if not_regular:
        raise DatasetError("EXPORT_FILE_NOT_REGULAR", failures=sorted(not_regular, key=lambda f: f["patientImageId"]))
    missing = [
        {"patientImageId": image_id, "code": "FILE_MISSING"}
        for name, image_id in expected.items()
        if name not in seen
    ]
    if missing:
        raise DatasetError("FILE_MISSING", failures=sorted(missing, key=lambda f: f["patientImageId"]))


def open_export(root: str | os.PathLike) -> SnapshotExport:
    """Validates a completed export; raises DatasetError (folder level)."""
    root = Path(root)
    if not root.is_dir():
        raise DatasetError("EXPORT_INCOMPLETE", detail="root is not a directory")
    marker = _validate_marker(_read_regular_file(root / MARKER_FILE, "EXPORT_INCOMPLETE"))
    raw = parse_manifest_bytes(_read_regular_file(root / MANIFEST_FILE, "EXPORT_INCOMPLETE"))
    manifest = validate_manifest(raw)
    if manifest.sha256 != marker["manifestSha256"]:
        raise DatasetError("MANIFEST_HASH_MISMATCH")
    if marker["snapshotId"] != manifest.snapshot_id:
        raise DatasetError("EXPORT_MARKER_MISMATCH", detail="snapshotId")
    if marker["itemCount"] != len(manifest.items):
        raise DatasetError("EXPORT_MARKER_MISMATCH", detail="itemCount")
    if marker["totalBytes"] != sum(item.file_size for item in manifest.items):
        raise DatasetError("EXPORT_MARKER_MISMATCH", detail="totalBytes")
    check_file_set(root, manifest)
    return SnapshotExport(root=root, manifest=manifest, marker=marker)
