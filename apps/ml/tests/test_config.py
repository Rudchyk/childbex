"""Configuration schema, canonical JSON and hash."""

import copy
import json

import pytest

from childbex_ml.preprocessing import ConfigError, canonical_json, config_hash, load_preset, resolve_config
from childbex_ml.preprocessing.config import hash_canonical

# Pinned: the meaning of these presets must never change silently.
MULTI_HASH = "1a3609705448b3a00789101fdbbb9ed958e5adfc60b7a5ac3f0cb5ccedf84275"
SINGLE_HASH = "5f3af5cf2f53efccb7f68621b01ed9bc14d88f7e1a573c1c2cb2e629624e10d2"


def test_preset_hashes_are_pinned(multi, single):
    assert config_hash(multi) == MULTI_HASH
    assert config_hash(single) == SINGLE_HASH


def test_multi_preset_canonical_json_is_pinned(multi):
    assert canonical_json(multi) == (
        '{"hu":{"method":"RESCALE_SLOPE_INTERCEPT_V1"},"mode":"MULTI_WINDOW_3CH",'
        '"order":"WINDOW_THEN_RESIZE","orientation":"AS_STORED",'
        '"output":{"channels":3,"dtype":"float32","range":[0,1]},'
        '"padding":{"paddingHu":-2048,"policy":"DECLARED_PIXEL_PADDING_TO_HU_V1"},'
        '"resize":{"aspectRatioBasis":"PIXEL_SPACING_V1","fillValue":0,"height":224,'
        '"interpolation":"AREA_V1","placement":"CENTER","width":224},'
        '"schemaVersion":1,"task":"CT_SLICE_BINARY_CLASSIFICATION",'
        '"windowFormula":"LINEAR_CLIP_V1",'
        '"windows":[{"center":40,"name":"soft_tissue","width":400},'
        '{"center":-600,"name":"lung","width":1500},'
        '{"center":500,"name":"bone","width":2000}]}'
    )


def test_same_resolved_config_same_hash(multi):
    reordered = json.loads(json.dumps(multi, sort_keys=True))
    as_floats = copy.deepcopy(multi)
    as_floats["windows"][0]["center"] = 40.0
    as_floats["resize"]["fillValue"] = 0
    assert {config_hash(multi), config_hash(reordered), config_hash(as_floats)} == {MULTI_HASH}
    assert config_hash(resolve_config(multi)) == MULTI_HASH


def _changed(config, mutate):
    changed = copy.deepcopy(config)
    mutate(changed)
    return changed


SEMANTIC_CHANGES = {
    "window center": lambda c: c["windows"][0].__setitem__("center", 50),
    "window width": lambda c: c["windows"][1].__setitem__("width", 1600),
    "window name": lambda c: c["windows"][2].__setitem__("name", "bone_wide"),
    "channel order": lambda c: c["windows"].reverse(),
    "channel swap lung/bone": lambda c: c["windows"].insert(1, c["windows"].pop(2)),
    "target height": lambda c: c["resize"].__setitem__("height", 256),
    "target width": lambda c: c["resize"].__setitem__("width", 256),
    "fill value": lambda c: c["resize"].__setitem__("fillValue", 0.5),
    "padding HU": lambda c: c["padding"].__setitem__("paddingHu", -3000),
}


@pytest.mark.parametrize("name", SEMANTIC_CHANGES)
def test_every_valid_semantic_change_changes_the_hash(multi, name):
    changed = _changed(multi, SEMANTIC_CHANGES[name])
    assert config_hash(changed) != MULTI_HASH


def test_mode_changes_the_hash(multi):
    single_like = _changed(multi, lambda c: (c.__setitem__("mode", "SINGLE_WINDOW_3CH"), c.__setitem__("windows", c["windows"][:1])))
    assert config_hash(single_like) == SINGLE_HASH != MULTI_HASH


# Choices with a single allowed value in schema version 1: they are part of
# the hashed form (a different value would hash differently) and rejected.
FIXED_CHOICES = {
    "hu.method": ("hu", "method", "OTHER_V1"),
    "padding.policy": ("padding", "policy", "IGNORE"),
    "windowFormula": (None, "windowFormula", "DICOM_VOI_LINEAR"),
    "order": (None, "order", "RESIZE_HU_THEN_WINDOW"),
    "resize.interpolation": ("resize", "interpolation", "BILINEAR"),
    "resize.aspectRatioBasis": ("resize", "aspectRatioBasis", "MATRIX"),
    "resize.placement": ("resize", "placement", "TOP_LEFT"),
    "orientation": (None, "orientation", "CANONICAL"),
    "output.dtype": ("output", "dtype", "float16"),
}


@pytest.mark.parametrize("name", FIXED_CHOICES)
def test_fixed_choices_are_hashed_and_other_values_rejected(multi, name):
    section, key, value = FIXED_CHOICES[name]
    changed = copy.deepcopy(multi)
    (changed[section] if section else changed)[key] = value
    assert hash_canonical(changed) != hash_canonical(multi)
    with pytest.raises(ConfigError):
        resolve_config(changed)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c: c.__setitem__("extra", 1),
        lambda c: c["resize"].__setitem__("antialias", True),
        lambda c: c["windows"][0].__setitem__("gamma", 1),
        lambda c: c.pop("order"),
        lambda c: c.__setitem__("schemaVersion", 2),
        lambda c: c.__setitem__("schemaVersion", True),
        lambda c: c.__setitem__("schemaVersion", "1"),
        lambda c: c.__setitem__("task", "CT_SEGMENTATION"),
        lambda c: c.__setitem__("mode", "MULTI_WINDOW_1CH"),
        lambda c: c["windows"].pop(),
        lambda c: c["windows"][1].__setitem__("name", "soft_tissue"),
        lambda c: c["windows"][0].__setitem__("width", 0),
        lambda c: c["windows"][0].__setitem__("center", float("nan")),
        lambda c: c["windows"][0].__setitem__("center", True),
        lambda c: c["windows"][0].__setitem__("name", "Soft Tissue"),
        lambda c: c["padding"].__setitem__("paddingHu", -1000),  # above lung lower bound -1350
        lambda c: c["resize"].__setitem__("height", 0),
        lambda c: c["resize"].__setitem__("width", 224.0),
        lambda c: c["resize"].__setitem__("fillValue", 1.5),
        lambda c: c["output"].__setitem__("channels", 1),
        lambda c: c["output"].__setitem__("range", [0, 255]),
    ],
)
def test_invalid_configs_are_rejected(multi, mutate):
    with pytest.raises(ConfigError):
        resolve_config(_changed(multi, mutate))


def test_single_window_mode_requires_one_window(single, multi):
    with pytest.raises(ConfigError):
        resolve_config(_changed(single, lambda c: c.__setitem__("windows", multi["windows"])))


def test_padding_hu_at_lowest_bound_is_allowed(multi):
    assert resolve_config(_changed(multi, lambda c: c["padding"].__setitem__("paddingHu", -1350)))


def test_unknown_preset_rejected():
    with pytest.raises(ConfigError):
        load_preset("ct-multi-window-v2")


def test_resolved_config_is_independent_copy(multi):
    resolved = resolve_config(multi)
    resolved["windows"][0]["center"] = 99
    assert load_preset("ct-multi-window-v1")["windows"][0]["center"] == 40
