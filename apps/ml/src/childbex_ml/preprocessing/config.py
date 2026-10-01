"""Versioned CT preprocessing configuration (schema version 1).

A configuration is always *fully resolved*: every semantically relevant
choice (HU method, padding policy, window formula, windows and their channel
order, operation order, resize geometry and interpolation, orientation,
output contract) is an explicit value, so the configuration hash identifies
the transformation. There are no hidden defaults; unknown keys, values and
versions are rejected. The meaning of schema version 1 never changes: other
values need a new configuration (and so a new hash) or a new version.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from importlib import resources
from pathlib import Path
from typing import Any

from .errors import ConfigError

SCHEMA_VERSION = 1

TASK = "CT_SLICE_BINARY_CLASSIFICATION"
MODE_MULTI = "MULTI_WINDOW_3CH"
MODE_SINGLE = "SINGLE_WINDOW_3CH"
HU_METHOD = "RESCALE_SLOPE_INTERCEPT_V1"
PADDING_POLICY = "DECLARED_PIXEL_PADDING_TO_HU_V1"
WINDOW_FORMULA = "LINEAR_CLIP_V1"
ORDER = "WINDOW_THEN_RESIZE"
INTERPOLATION = "AREA_V1"
ASPECT_RATIO_BASIS = "PIXEL_SPACING_V1"
PLACEMENT = "CENTER"
ORIENTATION = "AS_STORED"
OUTPUT = {"channels": 3, "dtype": "float32", "range": [0.0, 1.0]}

MAX_OUTPUT_SIZE = 4096

PRESET_NAMES = ("ct-multi-window-v1", "ct-single-window-v1")

_WINDOW_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")

TOP_LEVEL_KEYS = {
    "schemaVersion",
    "task",
    "mode",
    "hu",
    "padding",
    "windowFormula",
    "windows",
    "order",
    "resize",
    "orientation",
    "output",
}


def _where(path: str) -> str:
    return path or "config"


def _object(value: Any, path: str, keys: set[str]) -> dict:
    if not isinstance(value, dict):
        raise ConfigError(f"{_where(path)} must be an object")
    unknown = sorted(set(value) - keys)
    if unknown:
        raise ConfigError(f"{_where(path)} has unknown keys: {', '.join(unknown)}")
    missing = sorted(keys - set(value))
    if missing:
        raise ConfigError(f"{_where(path)} is missing keys: {', '.join(missing)}")
    return value


def _const(value: Any, path: str, expected: str) -> str:
    if value != expected or not isinstance(value, str):
        raise ConfigError(f"{path} must be {expected!r} in schema version {SCHEMA_VERSION}")
    return value


def _number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError(f"{path} must be a number")
    number = float(value)
    if not math.isfinite(number):
        raise ConfigError(f"{path} must be finite")
    return number


def _integer(value: Any, path: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ConfigError(f"{path} must be an integer in [{low}, {high}]")
    return value


def window_bounds(center: float, width: float) -> tuple[float, float]:
    """LINEAR_CLIP_V1 bounds in float64: center -/+ width / 2."""
    return center - width / 2, center + width / 2


def resolve_config(raw: Any) -> dict:
    """Validates a configuration and returns its normalized, resolved copy.

    Numbers become float (int for sizes and counts); nothing is defaulted.
    """
    config = _object(raw, "", TOP_LEVEL_KEYS)
    version = config["schemaVersion"]
    if isinstance(version, bool) or version != SCHEMA_VERSION or not isinstance(version, int):
        raise ConfigError("unsupported schemaVersion")
    _const(config["task"], "task", TASK)
    mode = config["mode"]
    if mode not in (MODE_MULTI, MODE_SINGLE):
        raise ConfigError(f"mode must be {MODE_MULTI!r} or {MODE_SINGLE!r}")

    hu = _object(config["hu"], "hu", {"method"})
    _const(hu["method"], "hu.method", HU_METHOD)

    padding = _object(config["padding"], "padding", {"policy", "paddingHu"})
    _const(padding["policy"], "padding.policy", PADDING_POLICY)
    padding_hu = _number(padding["paddingHu"], "padding.paddingHu")

    _const(config["windowFormula"], "windowFormula", WINDOW_FORMULA)

    windows_raw = config["windows"]
    expected_count = 3 if mode == MODE_MULTI else 1
    if not isinstance(windows_raw, list) or len(windows_raw) != expected_count:
        raise ConfigError(f"windows must be a list of {expected_count} window(s) for {mode}")
    windows = []
    for index, window_raw in enumerate(windows_raw):
        path = f"windows[{index}]"
        window = _object(window_raw, path, {"name", "center", "width"})
        name = window["name"]
        if not isinstance(name, str) or not _WINDOW_NAME.match(name):
            raise ConfigError(f"{path}.name must match {_WINDOW_NAME.pattern}")
        center = _number(window["center"], f"{path}.center")
        width = _number(window["width"], f"{path}.width")
        if width <= 0:
            raise ConfigError(f"{path}.width must be > 0")
        windows.append({"name": name, "center": center, "width": width})
    if len({window["name"] for window in windows}) != len(windows):
        raise ConfigError("window names must be unique")
    lowest = min(window_bounds(w["center"], w["width"])[0] for w in windows)
    if padding_hu > lowest:
        raise ConfigError("padding.paddingHu must be at or below every window's lower bound")

    _const(config["order"], "order", ORDER)

    resize = _object(
        config["resize"],
        "resize",
        {"height", "width", "interpolation", "aspectRatioBasis", "placement", "fillValue"},
    )
    height = _integer(resize["height"], "resize.height", 1, MAX_OUTPUT_SIZE)
    width = _integer(resize["width"], "resize.width", 1, MAX_OUTPUT_SIZE)
    _const(resize["interpolation"], "resize.interpolation", INTERPOLATION)
    _const(resize["aspectRatioBasis"], "resize.aspectRatioBasis", ASPECT_RATIO_BASIS)
    _const(resize["placement"], "resize.placement", PLACEMENT)
    fill_value = _number(resize["fillValue"], "resize.fillValue")
    if not 0.0 <= fill_value <= 1.0:
        raise ConfigError("resize.fillValue must be in [0, 1]")

    _const(config["orientation"], "orientation", ORIENTATION)

    output = _object(config["output"], "output", {"channels", "dtype", "range"})
    if (
        isinstance(output["channels"], bool)
        or output["channels"] != OUTPUT["channels"]
        or output["dtype"] != OUTPUT["dtype"]
        or not isinstance(output["range"], list)
        or [_number(v, "output.range") for v in output["range"]] != OUTPUT["range"]
    ):
        raise ConfigError(f"output must be {OUTPUT} in schema version {SCHEMA_VERSION}")

    return {
        "schemaVersion": SCHEMA_VERSION,
        "task": TASK,
        "mode": mode,
        "hu": {"method": HU_METHOD},
        "padding": {"policy": PADDING_POLICY, "paddingHu": padding_hu},
        "windowFormula": WINDOW_FORMULA,
        "windows": windows,
        "order": ORDER,
        "resize": {
            "height": height,
            "width": width,
            "interpolation": INTERPOLATION,
            "aspectRatioBasis": ASPECT_RATIO_BASIS,
            "placement": PLACEMENT,
            "fillValue": fill_value,
        },
        "orientation": ORIENTATION,
        "output": copy.deepcopy(OUTPUT),
    }


def _canonical_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _canonical_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical_value(item) for item in value]
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ConfigError("non-finite numbers cannot be serialized")
        if value.is_integer() and abs(value) < 2**53:
            return int(value)
        text = repr(value)
        if "e" in text or "E" in text:
            raise ConfigError("numbers needing an exponent are not supported in the canonical form")
        return value
    raise ConfigError("unsupported value type in configuration")


def canonical_json(value: Any) -> str:
    """Canonical JSON: sorted keys, no whitespace, UTF-8, integral numbers
    written as integers (40.0 -> 40), other numbers in the shortest
    round-trip decimal form; non-finite numbers and exponents are rejected.
    For the values schema version 1 allows this matches RFC 8785 (JCS).
    """
    return json.dumps(
        _canonical_value(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def hash_canonical(value: Any) -> str:
    """Lowercase hex SHA-256 of the canonical JSON (UTF-8) of any value."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def config_hash(config: Any) -> str:
    """SHA-256 of the canonical JSON of the fully resolved configuration."""
    return hash_canonical(resolve_config(config))


def load_preset(name: str) -> dict:
    if name not in PRESET_NAMES:
        raise ConfigError(f"unknown preset; available: {', '.join(PRESET_NAMES)}")
    text = resources.files(__package__).joinpath("presets", f"{name}.json").read_text("utf-8")
    return resolve_config(json.loads(text))


def load_config_file(path: str | Path) -> dict:
    try:
        text = Path(path).read_text("utf-8")
    except OSError:
        raise ConfigError("the configuration file could not be read") from None
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        raise ConfigError("the configuration file is not valid JSON") from None
    return resolve_config(raw)
