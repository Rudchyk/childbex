"""The canonical CT slice preprocessing (schema version 1):

DICOM bytes -> stored values (pydicom) -> HU -> declared padding to
paddingHu -> CT windows (float32 [0, 1] channels) -> AREA_V1 resize to the
PIXEL_SPACING_V1 content box -> CENTER letterbox with fillValue.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .config import SCHEMA_VERSION, config_hash, resolve_config
from .dicom import CtSlice, parse_dicom, validate_and_decode
from .hu import apply_padding, padding_mask, stored_to_hu
from .resize import ContentBox, area_resize, fit_content, letterbox
from .window import window_channels


@dataclass(frozen=True)
class PreprocessedSlice:
    """The model input and non-identifying metadata for reproducibility.

    Never holds UIDs, names, dates, file names or paths.
    """

    tensor: np.ndarray = field(repr=False)  # (outputRows, outputColumns, 3) float32 in [0, 1]
    shape: tuple[int, int, int]
    dtype: str
    preprocessing_schema_version: int
    preprocessing_config_hash: str
    original_rows: int
    original_columns: int
    output_rows: int
    output_columns: int
    content_box: ContentBox
    # HU range of the non-padding pixels (None when all pixels are padding).
    hu_min: float | None
    hu_max: float | None
    padding_pixel_count: int


def preprocess_ct_slice(ct: CtSlice, config: dict) -> PreprocessedSlice:
    resolved = resolve_config(config)
    hu = stored_to_hu(ct.stored, ct.rescale_slope, ct.rescale_intercept)
    mask = padding_mask(ct.stored, ct.padding_range)
    padding_count = int(np.count_nonzero(mask)) if mask is not None else 0
    measured = hu[~mask] if mask is not None else hu
    hu_min = float(measured.min()) if measured.size else None
    hu_max = float(measured.max()) if measured.size else None
    apply_padding(hu, mask, resolved["padding"]["paddingHu"])

    channels = window_channels(hu, resolved)  # WINDOW_THEN_RESIZE
    del hu

    size = resolved["resize"]
    box = fit_content(
        ct.rows, ct.columns, ct.row_spacing, ct.column_spacing, size["height"], size["width"]
    )
    resized = area_resize(channels, box.height, box.width)
    np.clip(resized, 0.0, 1.0, out=resized)
    tensor = letterbox(resized, box, size["height"], size["width"], size["fillValue"])

    return PreprocessedSlice(
        tensor=tensor,
        shape=tuple(tensor.shape),
        dtype=str(tensor.dtype),
        preprocessing_schema_version=SCHEMA_VERSION,
        preprocessing_config_hash=config_hash(resolved),
        original_rows=ct.rows,
        original_columns=ct.columns,
        output_rows=tensor.shape[0],
        output_columns=tensor.shape[1],
        content_box=box,
        hu_min=hu_min,
        hu_max=hu_max,
        padding_pixel_count=padding_count,
    )


def preprocess_dicom_bytes(data: bytes, config: dict) -> PreprocessedSlice:
    """Preprocesses one original DICOM file's bytes (verify them first with
    `load_verified_bytes` when they come from a DatasetSnapshot item)."""
    return preprocess_ct_slice(validate_and_decode(parse_dicom(data)), config)
