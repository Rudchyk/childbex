"""One snapshot item -> verified bytes -> canonical PR9 tensor (shared by
preflight and the training loader)."""

from __future__ import annotations

import os
import stat
from collections.abc import Callable
from pathlib import Path

import numpy as np

from ..preprocessing import PreprocessedSlice, PreprocessingError, load_verified_bytes, preprocess_dicom_bytes
from .errors import DatasetError
from .manifest import ManifestItem

Preprocess = Callable[[bytes, dict], PreprocessedSlice]


def read_item_bytes(path: Path, item: ManifestItem) -> bytes:
    """Regular file (no symlink), exact size and SHA-256 before decoding."""
    try:
        info = os.lstat(path)
    except OSError:
        raise DatasetError("FILE_MISSING", patient_image_id=item.patient_image_id) from None
    if not stat.S_ISREG(info.st_mode):
        raise DatasetError("EXPORT_FILE_NOT_REGULAR", patient_image_id=item.patient_image_id)
    try:
        return load_verified_bytes(path, item.file_sha256, item.file_size)
    except PreprocessingError as error:
        code = "FILE_MISSING" if error.code == "FILE_NOT_READABLE" else "FILE_INTEGRITY_MISMATCH"
        raise DatasetError(code, patient_image_id=item.patient_image_id) from None


def check_tensor(tensor: object, height: int, width: int) -> np.ndarray:
    """The PR9 output contract: exactly (height, width, 3) float32, finite, in [0, 1]."""
    if (
        not isinstance(tensor, np.ndarray)
        or tensor.shape != (height, width, 3)
        or tensor.dtype != np.float32
        or not np.isfinite(tensor).all()
        or tensor.min() < 0.0
        or tensor.max() > 1.0
    ):
        raise DatasetError("TENSOR_CONTRACT_VIOLATION")
    return tensor


def process_item(path: Path, item: ManifestItem, config: dict, preprocess: Preprocess = preprocess_dicom_bytes) -> PreprocessedSlice:
    """Raises DatasetError or PreprocessingError (both with `.code`)."""
    data = read_item_bytes(path, item)
    try:
        result = preprocess(data, config)
    except PreprocessingError:
        raise
    except Exception:
        raise DatasetError("PREPROCESSING_FAILED", patient_image_id=item.patient_image_id) from None
    try:
        check_tensor(result.tensor, config["resize"]["height"], config["resize"]["width"])
    except DatasetError:
        raise DatasetError("TENSOR_CONTRACT_VIOLATION", patient_image_id=item.patient_image_id) from None
    return result
