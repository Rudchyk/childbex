"""Training configuration v1 (TensorFlow-free)."""

import copy

import pytest

from childbex_ml.training import TrainingError, load_preset, resolve_config, training_config_sha256, training_recipe_sha256
from childbex_ml.training.config import parse_decimal

BINDING = {
    "artifactSha256": "a" * 64,
    "kind": "CHILDBEX_CT_SLICE_TENSORS_V1",
    "artifactSchemaVersion": 1,
    "manifestSha256": "b" * 64,
    "preflightIdentity": "c" * 64,
    "preprocessingConfigHash": "d" * 64,
}


@pytest.fixture
def preset():
    return load_preset("efficientnetv2b0-baseline-v1")


def code_of(fn):
    with pytest.raises(TrainingError) as error:
        fn()
    return error.value.code, error.value.detail


def test_preset_values(preset):
    assert preset["phases"][0]["optimizer"]["learningRate"] == "0.001"
    assert preset["phases"][1]["optimizer"]["learningRate"] == "0.00001"
    assert preset["determinism"] == "STRICT"
    assert preset["model"]["inputShape"] == [224, 224, 3]
    assert preset["augmentation"]["policy"] == "CT2D_AFFINE_V1"
    assert preset["checkpoint"] == {"monitor": "val_pr_auc", "mode": "max"}


@pytest.mark.parametrize(
    ("text", "value"),
    [("0.001", 0.001), ("0.00001", 0.00001), ("1", 1.0), ("0.5", 0.5), ("12.25", 12.25)],
)
def test_canonical_decimal_strings(text, value):
    assert parse_decimal(text, "lr") == value


@pytest.mark.parametrize("text", ["1e-5", "1E-5", "0.0010", "00.001", ".001", "0", "0.0", "-0.001", "+0.001", " 0.001", 0.001, 1, None, "0.001 "])
def test_non_canonical_decimals_rejected(text):
    assert code_of(lambda: parse_decimal(text, "lr"))[0] == "INVALID_TRAINING_CONFIG"


def test_hashes_are_deterministic_and_split_recipe_from_artifact(preset):
    resolved = resolve_config(preset, BINDING)
    again = resolve_config(copy.deepcopy(preset), dict(reversed(list(BINDING.items()))))
    assert training_config_sha256(resolved) == training_config_sha256(again)
    assert training_recipe_sha256(resolved) == training_recipe_sha256(preset)
    other_artifact = resolve_config(preset, {**BINDING, "artifactSha256": "e" * 64, "preprocessingConfigHash": "f" * 64})
    assert training_recipe_sha256(other_artifact) == training_recipe_sha256(resolved)  # same recipe
    assert training_config_sha256(other_artifact) != training_config_sha256(resolved)  # different data


CHANGES = {
    "global seed": lambda c: c["seeds"].__setitem__("global", 1),
    "train order seed": lambda c: c["seeds"].__setitem__("trainOrder", 1),
    "augmentation seed": lambda c: c["seeds"].__setitem__("augmentation", 1),
    "head lr": lambda c: c["phases"][0]["optimizer"].__setitem__("learningRate", "0.0001"),
    "fine-tune lr": lambda c: c["phases"][1]["optimizer"].__setitem__("learningRate", "0.000001"),
    "batch size": lambda c: c["data"].__setitem__("batchSize", 16),
    "epochs": lambda c: c["phases"][0].__setitem__("maxEpochs", 10),
    "patience": lambda c: c["phases"][1].__setitem__("earlyStoppingPatience", 3),
    "class weighting": lambda c: c.__setitem__("classWeighting", "TRAIN_BALANCED_V1"),
    "augmentation off": lambda c: c.__setitem__("augmentation", {"policy": "NONE"}),
    "weights": lambda c: c["model"].__setitem__("weights", "NONE"),
    "dropout": lambda c: c["model"].__setitem__("dropout", "0.3"),
    "determinism": lambda c: c.__setitem__("determinism", "BEST_EFFORT"),
}


@pytest.mark.parametrize("name", CHANGES)
def test_every_change_changes_both_hashes(preset, name):
    changed = copy.deepcopy(preset)
    CHANGES[name](changed)
    assert training_recipe_sha256(changed) != training_recipe_sha256(preset)
    assert training_config_sha256(resolve_config(changed, BINDING)) != training_config_sha256(resolve_config(preset, BINDING))


def test_no_timestamp_or_runtime_in_the_config(preset):
    import re

    resolved = resolve_config(preset, BINDING)
    keys, values = set(), []

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                keys.add(key)
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
        else:
            values.append(str(node))

    walk(resolved)
    assert not keys & {"createdAt", "startedAt", "finishedAt", "timestamp", "tensorflowVersion", "kerasVersion",
                       "pythonVersion", "numpyVersion", "devices", "gitCommit", "path"}
    assert not any(re.search(r"\d{4}-\d{2}-\d{2}T", value) for value in values)
    assert not any("/" in value or "\\" in value for value in values)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda c: c.__setitem__("extra", 1),
        lambda c: c.pop("seeds"),
        lambda c: c.__setitem__("trainingSchemaVersion", 2),
        lambda c: c.__setitem__("runtimeProfile", "TRAINING_RUNTIME_V2"),
        lambda c: c["model"].__setitem__("inputShape", [32, 32, 3]),
        lambda c: c["model"].__setitem__("inputAdapter", "KERAS_BUILTIN"),
        lambda c: c["model"].__setitem__("weights", "imagenet"),
        lambda c: c["model"].__setitem__("output", "SIGMOID"),
        lambda c: c["phases"][0]["optimizer"].__setitem__("learningRate", 0.001),
        lambda c: c["phases"][0]["optimizer"].__setitem__("learningRate", "1e-3"),
        lambda c: c["phases"].reverse(),
        lambda c: c["phases"].pop(),
        lambda c: c.__setitem__("classWeighting", "OVERSAMPLE"),
        lambda c: c["augmentation"].__setitem__("horizontalFlip", True),
        lambda c: c.__setitem__("augmentation", {"policy": "RANDAUGMENT"}),
        lambda c: c["checkpoint"].__setitem__("monitor", "val_loss"),
        lambda c: c["data"].__setitem__("validationOrder", "SHUFFLED"),
        lambda c: c.__setitem__("labelEncoding", {"NORMAL": 1, "ABNORMAL": 0}),
        lambda c: c["seeds"].__setitem__("global", -1),
    ],
)
def test_invalid_configs_rejected(preset, mutate):
    changed = copy.deepcopy(preset)
    mutate(changed)
    assert code_of(lambda: resolve_config(changed, BINDING))[0] == "INVALID_TRAINING_CONFIG"


def test_configured_artifact_binding_must_match(preset):
    bound = {**copy.deepcopy(preset), "artifact": BINDING}
    assert resolve_config(bound, BINDING)["artifact"] == BINDING
    assert code_of(lambda: resolve_config(bound, {**BINDING, "artifactSha256": "9" * 64}))[0] == "ARTIFACT_MISMATCH"
    assert code_of(lambda: resolve_config(preset))[0] == "INVALID_TRAINING_CONFIG"
