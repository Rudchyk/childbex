"""LINEAR_CLIP_V1 windowing into CT intensity channels."""

from __future__ import annotations

import numpy as np

from .config import MODE_SINGLE, window_bounds


def window_limits(center: float, width: float) -> tuple[np.float32, np.float32]:
    """lower / upper = center -/+ width / 2 in float64, rounded to float32."""
    lower, upper = window_bounds(center, width)
    return np.float32(lower), np.float32(upper)


def apply_window(hu: np.ndarray, center: float, width: float, out: np.ndarray | None = None) -> np.ndarray:
    """(clip(HU, lower, upper) - lower) / (upper - lower), all in float32.

    Monotonic: a higher HU never gives a lower value. The result is in
    [0, 1]: 0 at or below `lower`, 1 at or above `upper`.
    """
    lower, upper = window_limits(center, width)
    span = np.float32(upper - lower)
    out = np.clip(hu, lower, upper, out=out)
    out -= lower
    out /= span
    return out


def window_channels(hu: np.ndarray, config: dict) -> np.ndarray:
    """(rows, columns, 3) float32 channels; channel i = windows[i]
    (MULTI_WINDOW_3CH) or windows[0] in every channel (SINGLE_WINDOW_3CH)."""
    channels = np.empty(hu.shape + (3,), dtype=np.float32)
    windows = config["windows"]
    if config["mode"] == MODE_SINGLE:
        apply_window(hu, windows[0]["center"], windows[0]["width"], out=channels[..., 0])
        channels[..., 1] = channels[..., 0]
        channels[..., 2] = channels[..., 0]
    else:
        for index, window in enumerate(windows):
            apply_window(hu, window["center"], window["width"], out=channels[..., index])
    return channels
