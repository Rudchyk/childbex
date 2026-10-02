"""Helpers for PR11 tests: synthetic 224x224 cloud artifacts with both classes
in TRAIN and VALIDATION, a tiny injected backbone, an offline weight
resolver, and a socket guard (no network in training tests)."""

from __future__ import annotations

import copy
import hashlib
import socket
from pathlib import Path

from childbex_ml.preprocessing import load_preset as load_preprocessing_preset
from cloud_helpers import build, ready_export

# (n, patient, split, label, dicom kwargs)
TRAINING_ITEMS = [
    (1, 1, "TRAIN", "NORMAL", {}),
    (2, 1, "TRAIN", "NORMAL", {}),
    (3, 1, "TRAIN", "ABNORMAL", {}),
    (4, 2, "TRAIN", "NORMAL", {}),
    (5, 3, "TRAIN", "ABNORMAL", {}),
    (6, 3, "TRAIN", "ABNORMAL", {}),
    (7, 4, "TRAIN", "NORMAL", {}),
    (8, 5, "VALIDATION", "NORMAL", {}),
    (9, 6, "VALIDATION", "ABNORMAL", {}),
    (10, 6, "VALIDATION", "ABNORMAL", {}),
    (11, 7, "TEST", "ABNORMAL", {}),
    (12, 8, "TEST", "NORMAL", {}),
]


def make_artifact(base: Path, *, preset: str = "ct-multi-window-v1", items=TRAINING_ITEMS, name: str = "artifact") -> dict:
    """A preflighted PR10 export -> PR10.5 cloud artifact (224x224x3)."""
    export = ready_export(base, items, preset=preset)
    return build(base, export, name, preset=preset, shard_size=4)


def make_small_artifact(base: Path) -> dict:
    """A cloud artifact with 32x32 tensors (rejected by production PR11)."""
    from childbex_ml.dataset import run_preflight
    from childbex_ml.cloud_artifact.build import build_cloud_artifact
    from cloud_helpers import attestation_for, write_json
    from dataset_builder import build_export

    config = copy.deepcopy(load_preprocessing_preset("ct-multi-window-v1"))
    config["resize"]["height"] = config["resize"]["width"] = 32
    export = build_export(base / "export", TRAINING_ITEMS)
    run_preflight(export["root"], config)
    attestation = write_json(base / "attestation.json", attestation_for(export["sha256"]))
    build_cloud_artifact(export["root"], config, base / "artifact", base / "provenance.json", attestation)
    return {"root": base / "artifact"}


def tiny_backbone():
    """Same orchestration contract as EfficientNetV2B0 (224x224x3 input,
    pooled features, block6* / top_conv / BatchNorm layer names), but tiny."""
    from childbex_ml.training.model import BACKBONE_NAME, BackboneSpec

    def build_tiny(weights_path):
        import keras
        from keras import layers

        inputs = keras.Input((224, 224, 3))
        x = layers.Conv2D(4, 3, strides=8, name="stem_conv")(inputs)
        x = layers.BatchNormalization(name="stem_bn")(x)
        x = layers.Conv2D(4, 3, strides=2, name="block6a_project_conv")(x)
        x = layers.BatchNormalization(name="block6a_project_bn")(x)
        x = layers.Conv2D(8, 1, name="top_conv")(x)
        x = layers.BatchNormalization(name="top_bn")(x)
        x = layers.GlobalAveragePooling2D(name="avg_pool")(x)
        return keras.Model(inputs, x, name=BACKBONE_NAME)

    return BackboneSpec(build=build_tiny, fine_tune_blocks=frozenset({"block6a"}))


def fake_weights_fetch(tmp_path: Path):
    """Offline stand-in for keras.utils.get_file: records the call and returns
    a local file. Its MD5 cannot equal the official checksum, so tests that
    need a successful resolution register a spec with this file's MD5."""
    calls = []
    payload = b"synthetic weights"
    target = tmp_path / "efficientnetv2-b0_notop.h5"
    target.write_bytes(payload)

    def fetch(**kwargs):
        calls.append(kwargs)
        return str(target)

    fetch.calls = calls
    fetch.md5 = hashlib.md5(payload).hexdigest()
    fetch.sha256 = hashlib.sha256(payload).hexdigest()
    return fetch


def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise RuntimeError("network access is not allowed in tests")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def smoke_config(preset_overrides: dict | None = None) -> dict:
    from childbex_ml.training import load_preset

    config = load_preset("efficientnetv2b0-baseline-v1")
    config["model"]["weights"] = "NONE"
    config["data"]["batchSize"] = 4
    config["phases"][0]["maxEpochs"] = 2
    config["phases"][1]["maxEpochs"] = 2
    for key, value in (preset_overrides or {}).items():
        config[key] = value
    return config
