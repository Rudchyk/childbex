"""Stored values -> Hounsfield Units (RESCALE_SLOPE_INTERCEPT_V1) and the
declared pixel padding policy (DECLARED_PIXEL_PADDING_TO_HU_V1)."""

from __future__ import annotations

import numpy as np


def padding_mask(stored: np.ndarray, padding_range: tuple[int, int] | None) -> np.ndarray | None:
    """Pixels whose *stored* value (before rescale, signed per
    PixelRepresentation) lies in the inclusive declared padding range:
    PixelPaddingValue alone, or the range between it and
    PixelPaddingRangeLimit. None when no padding is declared."""
    if padding_range is None:
        return None
    low, high = padding_range
    if low == high:
        return stored == low
    return (stored >= low) & (stored <= high)


def stored_to_hu(stored: np.ndarray, slope: float, intercept: float) -> np.ndarray:
    """HU = float32(stored) * float32(slope) + float32(intercept), each
    operation rounded to float32 (no fused multiply-add)."""
    hu = stored.astype(np.float32)
    hu *= np.float32(slope)
    hu += np.float32(intercept)
    return hu


def apply_padding(hu: np.ndarray, mask: np.ndarray | None, padding_hu: float) -> np.ndarray:
    """Sets declared padding pixels to float32(paddingHu), in place."""
    if mask is not None:
        hu[mask] = np.float32(padding_hu)
    return hu
