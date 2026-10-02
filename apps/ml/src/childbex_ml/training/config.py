"""Training configuration, schema version 1 (TensorFlow-free).

A configuration is fully explicit; unknown keys and values are rejected.
Learning rates are canonical decimal strings ("0.001", "0.00001"): the
shared canonical JSON (`childbex_ml.canonical`) rejects exponent notation
and is deliberately not changed. They are converted to numbers only when an
optimizer is built.

    trainingConfigSha256 = SHA-256(canonical JSON of the complete resolved config)
    trainingRecipeSha256 = SHA-256(canonical JSON of the config without "artifact")

Neither contains timestamps, runtime versions or paths: those are recorded
in runtime.json / provenance.json.
"""

from __future__ import annotations

import copy
import json
import re
from decimal import Decimal
from importlib import resources
from pathlib import Path
from typing import Any

from ..canonical import hash_canonical
from .errors import TrainingError

TRAINING_SCHEMA_VERSION = 1
TASK = "CT_SLICE_BINARY_CLASSIFICATION"
RUNTIME_PROFILE = "TRAINING_RUNTIME_V1"
ARCHITECTURE = "EFFICIENTNETV2B0_BINARY_LOGIT_V1"
INPUT_ADAPTER = "EFFICIENTNETV2_IMAGENET_INPUT_V1"
WEIGHTS = ("EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1", "NONE")
INPUT_SHAPE = [224, 224, 3]
LABEL_ENCODING = {"NORMAL": 0, "ABNORMAL": 1}
TRAIN_ORDER = "EPOCH_SHA256_ORDER_V1"
AUGMENTATIONS = ("NONE", "CT2D_AFFINE_V1")
CLASS_WEIGHTINGS = ("NONE", "TRAIN_BALANCED_V1")
METRICS = "BINARY_LOGIT_METRICS_V1"
DETERMINISM = ("STRICT", "BEST_EFFORT")
PHASES = ("HEAD", "FINE_TUNE")
TRAINABLE = {"HEAD": "HEAD_ONLY_V1", "FINE_TUNE": "BLOCK6_AND_TOP_CONV_BN_FROZEN_V1"}
PRESET_NAMES = ("efficientnetv2b0-baseline-v1",)

# Canonical positive decimal: no exponent, no sign, no superfluous zeros.
DECIMAL = re.compile(r"^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$")
MAX_SEED = 2**32 - 1


def parse_decimal(value: Any, where: str) -> float:
    """Validates a canonical decimal string (> 0) and returns its float value."""
    if not isinstance(value, str) or not DECIMAL.match(value) or Decimal(value) <= 0:
        raise TrainingError("INVALID_TRAINING_CONFIG", f"{where} must be a canonical positive decimal string")
    return float(Decimal(value))


def _exact(value: Any, keys: set[str], where: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise TrainingError("INVALID_TRAINING_CONFIG", where)
    return value


def _const(value: Any, expected: Any, where: str) -> None:
    if value != expected or type(value) is not type(expected):
        raise TrainingError("INVALID_TRAINING_CONFIG", where)


def _int(value: Any, where: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise TrainingError("INVALID_TRAINING_CONFIG", where)
    return value


def _fraction(value: Any, where: str, high: float) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= high:
        raise TrainingError("INVALID_TRAINING_CONFIG", where)


SHA256 = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_KEYS = {
    "artifactSha256",
    "kind",
    "artifactSchemaVersion",
    "manifestSha256",
    "preflightIdentity",
    "preprocessingConfigHash",
}


def _validate_artifact_binding(binding: Any) -> None:
    _exact(binding, ARTIFACT_KEYS, "artifact")
    for key in ("artifactSha256", "manifestSha256", "preflightIdentity", "preprocessingConfigHash"):
        if not isinstance(binding[key], str) or not SHA256.match(binding[key]):
            raise TrainingError("INVALID_TRAINING_CONFIG", f"artifact.{key}")
    _const(binding["kind"], "CHILDBEX_CT_SLICE_TENSORS_V1", "artifact.kind")
    _const(binding["artifactSchemaVersion"], 1, "artifact.artifactSchemaVersion")


def validate_recipe(config: Any) -> dict:
    """Validates everything except the artifact binding; returns a copy."""
    keys = {
        "trainingSchemaVersion", "task", "runtimeProfile", "labelEncoding", "model", "data",
        "augmentation", "classWeighting", "phases", "checkpoint", "metrics", "seeds", "determinism",
    }
    if not isinstance(config, dict):
        raise TrainingError("INVALID_TRAINING_CONFIG", "config")
    _exact({k: v for k, v in config.items() if k != "artifact"}, keys, "config")
    _const(config["trainingSchemaVersion"], TRAINING_SCHEMA_VERSION, "trainingSchemaVersion")
    _const(config["task"], TASK, "task")
    _const(config["runtimeProfile"], RUNTIME_PROFILE, "runtimeProfile")
    if config["labelEncoding"] != LABEL_ENCODING:
        raise TrainingError("INVALID_TRAINING_CONFIG", "labelEncoding")

    model = _exact(config["model"], {"architecture", "inputShape", "inputAdapter", "weights", "pooling", "dropout", "output"}, "model")
    _const(model["architecture"], ARCHITECTURE, "model.architecture")
    if model["inputShape"] != INPUT_SHAPE:
        raise TrainingError("INVALID_TRAINING_CONFIG", "model.inputShape")
    _const(model["inputAdapter"], INPUT_ADAPTER, "model.inputAdapter")
    if model["weights"] not in WEIGHTS:
        raise TrainingError("INVALID_TRAINING_CONFIG", "model.weights")
    _const(model["pooling"], "AVG", "model.pooling")
    _const(model["output"], "LOGIT", "model.output")
    if not isinstance(model["dropout"], str) or not DECIMAL.match(model["dropout"]) or not Decimal(model["dropout"]) < 1:
        raise TrainingError("INVALID_TRAINING_CONFIG", "model.dropout")

    data = _exact(config["data"], {"batchSize", "trainOrder", "validationOrder"}, "data")
    _int(data["batchSize"], "data.batchSize", 1, 4096)
    _const(data["trainOrder"], TRAIN_ORDER, "data.trainOrder")
    _const(data["validationOrder"], "CANONICAL", "data.validationOrder")

    augmentation = config["augmentation"]
    if not isinstance(augmentation, dict) or augmentation.get("policy") not in AUGMENTATIONS:
        raise TrainingError("INVALID_TRAINING_CONFIG", "augmentation.policy")
    if augmentation["policy"] == "NONE":
        _exact(augmentation, {"policy"}, "augmentation")
    else:
        _exact(augmentation, {"policy", "rotationDegrees", "translationFraction", "zoomFraction", "interpolation", "fill"}, "augmentation")
        _int(augmentation["rotationDegrees"], "augmentation.rotationDegrees", 0, 30)
        _fraction(augmentation["translationFraction"], "augmentation.translationFraction", 0.5)
        _fraction(augmentation["zoomFraction"], "augmentation.zoomFraction", 0.5)
        _const(augmentation["interpolation"], "BILINEAR", "augmentation.interpolation")
        _const(augmentation["fill"], "CONSTANT_0", "augmentation.fill")

    if config["classWeighting"] not in CLASS_WEIGHTINGS:
        raise TrainingError("INVALID_TRAINING_CONFIG", "classWeighting")

    phases = config["phases"]
    if not isinstance(phases, list) or [p.get("name") if isinstance(p, dict) else None for p in phases] != list(PHASES):
        raise TrainingError("INVALID_TRAINING_CONFIG", "phases")
    for phase in phases:
        where = f"phases.{phase['name']}"
        keys = {"name", "trainable", "optimizer", "maxEpochs", "earlyStoppingPatience"}
        if phase["name"] == "FINE_TUNE":
            keys.add("initFrom")
        _exact(phase, keys, where)
        _const(phase["trainable"], TRAINABLE[phase["name"]], f"{where}.trainable")
        optimizer = _exact(phase["optimizer"], {"name", "learningRate"}, f"{where}.optimizer")
        _const(optimizer["name"], "ADAM", f"{where}.optimizer.name")
        parse_decimal(optimizer["learningRate"], f"{where}.optimizer.learningRate")
        _int(phase["maxEpochs"], f"{where}.maxEpochs", 1, 1000)
        _int(phase["earlyStoppingPatience"], f"{where}.earlyStoppingPatience", 1, 1000)
        if phase["name"] == "FINE_TUNE":
            _const(phase["initFrom"], "BEST_HEAD_CHECKPOINT", f"{where}.initFrom")

    checkpoint = _exact(config["checkpoint"], {"monitor", "mode"}, "checkpoint")
    _const(checkpoint["monitor"], "val_pr_auc", "checkpoint.monitor")
    _const(checkpoint["mode"], "max", "checkpoint.mode")
    _const(config["metrics"], METRICS, "metrics")
    seeds = _exact(config["seeds"], {"global", "trainOrder", "augmentation"}, "seeds")
    for key in seeds:
        _int(seeds[key], f"seeds.{key}", 0, MAX_SEED)
    if config["determinism"] not in DETERMINISM:
        raise TrainingError("INVALID_TRAINING_CONFIG", "determinism")
    return copy.deepcopy({k: v for k, v in config.items() if k != "artifact"})


def resolve_config(config: Any, artifact_binding: dict | None = None) -> dict:
    """The complete resolved config: recipe + artifact binding. A binding in
    the file must equal the one of the opened artifact (`ARTIFACT_MISMATCH`)."""
    recipe = validate_recipe(config)
    binding = config.get("artifact") if isinstance(config, dict) else None
    if binding is not None:
        _validate_artifact_binding(binding)
    if artifact_binding is not None:
        _validate_artifact_binding(artifact_binding)
        if binding is not None and binding != artifact_binding:
            raise TrainingError("ARTIFACT_MISMATCH")
        binding = artifact_binding
    if binding is None:
        raise TrainingError("INVALID_TRAINING_CONFIG", "artifact binding missing")
    return {**recipe, "artifact": copy.deepcopy(binding)}


def training_config_sha256(resolved: dict) -> str:
    return hash_canonical(resolved)


def training_recipe_sha256(config: dict) -> str:
    return hash_canonical(validate_recipe(config))


def load_preset(name: str) -> dict:
    if name not in PRESET_NAMES:
        raise TrainingError("INVALID_TRAINING_CONFIG", "unknown preset")
    text = resources.files(__package__).joinpath("presets", f"{name}.json").read_text("utf-8")
    return json.loads(text)


def load_config_file(path: str | Path) -> dict:
    try:
        return json.loads(Path(path).read_text("utf-8"))
    except (OSError, ValueError):
        raise TrainingError("INVALID_TRAINING_CONFIG", "the configuration file could not be read") from None
