"""Aspect-ratio fit (PIXEL_SPACING_V1), AREA_V1 resampling and CENTER
letterboxing.

AREA_V1 along one axis from n input to m output samples: output sample i
covers the input interval [i*n/m, (i+1)*n/m) and is the mean of the input
samples over it, each weighted by its exact overlap with that interval:

    w[i][j] = |[j, j+1) & [i*n/m, (i+1)*n/m)| / (n/m)

The weights are computed with exact rational arithmetic and rounded once to
float64. The image is resampled along rows first, then along columns; each
output value is accumulated in float64, in ascending input index order, and
finally rounded to float32. Every channel gets exactly the same weights.
The pipeline then clips the windowed result to [0, 1]: the weights sum to 1,
so the clip only removes float64 rounding excess.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache

import numpy as np


@dataclass(frozen=True)
class ContentBox:
    """Where the resized slice lies inside the output (the rest is fill)."""

    top: int
    left: int
    height: int
    width: int


def fit_content(
    rows: int,
    columns: int,
    row_spacing: float,
    column_spacing: float,
    target_height: int,
    target_width: int,
) -> ContentBox:
    """PIXEL_SPACING_V1 + CENTER, in IEEE-754 float64.

    physicalHeight = rows * rowSpacing, physicalWidth = columns * columnSpacing
    scale = min(targetHeight / physicalHeight, targetWidth / physicalWidth)
    height = clamp(floor(physicalHeight * scale + 0.5), 1, targetHeight)
    width  = clamp(floor(physicalWidth  * scale + 0.5), 1, targetWidth)
    top = (targetHeight - height) // 2, left = (targetWidth - width) // 2
    """
    physical_height = rows * row_spacing
    physical_width = columns * column_spacing
    scale = min(target_height / physical_height, target_width / physical_width)
    height = min(target_height, max(1, math.floor(physical_height * scale + 0.5)))
    width = min(target_width, max(1, math.floor(physical_width * scale + 0.5)))
    return ContentBox(
        top=(target_height - height) // 2,
        left=(target_width - width) // 2,
        height=height,
        width=width,
    )


@lru_cache(maxsize=64)
def area_weights(n_in: int, n_out: int) -> tuple[tuple[int, tuple[float, ...]], ...]:
    """Per output index: (first input index, weights of consecutive inputs)."""
    bands = []
    scale = Fraction(n_in, n_out)
    for i in range(n_out):
        start, end = i * scale, (i + 1) * scale
        first = math.floor(start)
        last = math.ceil(end)  # exclusive
        weights = []
        for j in range(first, last):
            overlap = min(end, Fraction(j + 1)) - max(start, Fraction(j))
            weights.append(float(overlap / scale))
        while weights and weights[-1] == 0.0:
            weights.pop()
        bands.append((first, tuple(weights)))
    return tuple(bands)


def _resample_axis(values: np.ndarray, n_out: int, axis: int) -> np.ndarray:
    moved = np.moveaxis(values, axis, 0)
    out = np.empty((n_out,) + moved.shape[1:], dtype=np.float64)
    for i, (first, weights) in enumerate(area_weights(moved.shape[0], n_out)):
        acc = moved[first] * weights[0]
        for k in range(1, len(weights)):
            acc = acc + moved[first + k] * weights[k]
        out[i] = acc
    return np.moveaxis(out, 0, axis)


def area_resize(image: np.ndarray, height: int, width: int) -> np.ndarray:
    """AREA_V1 resize of an (H, W, C) or (H, W) float image to float32."""
    values = image.astype(np.float64)
    if values.shape[0] != height:
        values = _resample_axis(values, height, 0)
    if values.shape[1] != width:
        values = _resample_axis(values, width, 1)
    return values.astype(np.float32)


def letterbox(content: np.ndarray, box: ContentBox, target_height: int, target_width: int, fill: float) -> np.ndarray:
    """Places the resized channels at `box` in a float32 canvas of `fill`."""
    canvas = np.full((target_height, target_width, content.shape[2]), np.float32(fill), dtype=np.float32)
    canvas[box.top : box.top + box.height, box.left : box.left + box.width] = content
    return canvas
