"""Training-ready, lazy access to a preflighted snapshot export.

`SnapshotDataset.open()` requires a completed export with a valid manifest
hash and a passing preflight report whose identity matches this export, this
preprocessing configuration and the *current* runtime. Samples are produced
one at a time (verify bytes -> PR9 preprocessing -> tensor contract); no
tensor cache, no shuffling. Any error aborts iteration: nothing is skipped.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..preprocessing import PreprocessingError, config_hash, preprocess_dicom_bytes, resolve_config
from .errors import DatasetError
from .export import SnapshotExport, open_export
from .items import Preprocess, process_item
from .manifest import SPLITS, ManifestItem
from .preflight import LABEL_ENCODING_V1, PREFLIGHT_SCHEMA_VERSION, preflight_identity, report_path
from .runtime import runtime_fingerprint


@dataclass(frozen=True)
class Sample:
    tensor: np.ndarray = field(repr=False)  # (224, 224, 3) float32 in [0, 1] for the presets
    label: str  # "NORMAL" | "ABNORMAL"
    label_index: int  # LABEL_ENCODING_V1[label]
    split: str
    patient_group_key: str
    patient_id: str
    study_id: str
    series_id: str
    series_order_index: int
    patient_image_id: str


class SnapshotDataset:
    def __init__(self, export: SnapshotExport, config: dict, report: dict, preprocess: Preprocess):
        self._export = export
        self._config = config
        self._preprocess = preprocess
        self.report = report
        self.snapshot_id = export.manifest.snapshot_id
        self.manifest_sha256 = export.manifest.sha256
        self.preprocessing_config_hash = report["preprocessing"]["configHash"]
        self.preflight_identity = report["preflightIdentity"]
        self.label_encoding = dict(LABEL_ENCODING_V1)

    @classmethod
    def open(
        cls,
        root: str | os.PathLike,
        config: dict,
        *,
        report_dir: str | os.PathLike | None = None,
        preprocess: Preprocess = preprocess_dicom_bytes,
    ) -> "SnapshotDataset":
        resolved = resolve_config(config)
        preprocessing_hash = config_hash(resolved)
        export = open_export(root)
        path = report_path(export.root, preprocessing_hash, report_dir)
        try:
            report = json.loads(Path(path).read_text("utf-8"))
        except FileNotFoundError:
            raise DatasetError("PREFLIGHT_REQUIRED") from None
        except (OSError, ValueError):
            raise DatasetError("PREFLIGHT_STALE", detail="unreadable report") from None
        if not isinstance(report, dict) or report.get("preflightSchemaVersion") != PREFLIGHT_SCHEMA_VERSION:
            raise DatasetError("PREFLIGHT_STALE", detail="report schema")
        if report.get("ok") is not True or report.get("failedItems") != 0:
            raise DatasetError("PREFLIGHT_FAILED")

        runtime = runtime_fingerprint()
        expected = preflight_identity(export.manifest.snapshot_id, export.manifest.sha256, preprocessing_hash, runtime)
        if (
            report.get("runtime") != runtime
            or report.get("snapshotId") != export.manifest.snapshot_id
            or report.get("manifestSha256") != export.manifest.sha256
            or (report.get("preprocessing") or {}).get("configHash") != preprocessing_hash
            or report.get("preflightIdentity") != expected
            or report.get("labelEncoding") != LABEL_ENCODING_V1
            or report.get("totalItems") != len(export.manifest.items)
        ):
            raise DatasetError("PREFLIGHT_STALE")
        return cls(export, resolved, report, preprocess)

    def items(self, split: str) -> tuple[ManifestItem, ...]:
        """Frozen manifest items of one split, in canonical order
        (patientGroupKey, seriesId, seriesOrderIndex, patientImageId)."""
        if split not in SPLITS:
            raise ValueError(f"split must be one of {', '.join(SPLITS)}")
        return tuple(item for item in self._export.manifest.items if item.split == split)

    def count(self, split: str) -> int:
        return len(self.items(split))

    def iter_split(self, split: str) -> Iterator[Sample]:
        """Lazily yields the samples of one split; raises on the first error."""
        items = self.items(split)
        return self._iterate(items)

    def _iterate(self, items: tuple[ManifestItem, ...]) -> Iterator[Sample]:
        for item in items:
            try:
                result = process_item(self._export.dicom_path(item.patient_image_id), item, self._config, self._preprocess)
            except PreprocessingError as error:
                raise DatasetError("PREPROCESSING_FAILED", detail=error.code, patient_image_id=item.patient_image_id) from None
            yield Sample(
                tensor=result.tensor,
                label=item.label,
                label_index=LABEL_ENCODING_V1[item.label],
                split=item.split,
                patient_group_key=item.patient_group_key,
                patient_id=item.patient_id,
                study_id=item.study_id,
                series_id=item.series_id,
                series_order_index=item.series_order_index,
                patient_image_id=item.patient_image_id,
            )
