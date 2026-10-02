"""End-to-end PR11 runs with the tiny injected backbone (same orchestration and
production artifact validation), failure codes, TEST isolation, privacy."""

import copy
import hashlib
import json
import re
import shutil

import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")
keras = pytest.importorskip("keras")

import childbex_ml.training.weights as weights_module  # noqa: E402
from childbex_ml.cloud_artifact import CloudArtifact  # noqa: E402
from childbex_ml.training import TrainingError, resolve_config, training_config_sha256, training_recipe_sha256  # noqa: E402
from childbex_ml.training.train import artifact_binding, train  # noqa: E402
from childbex_ml.training.weights import EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1 as SPEC  # noqa: E402
from childbex_ml.training.weights import WeightSpec  # noqa: E402
from training_helpers import fake_weights_fetch, make_artifact, make_small_artifact, smoke_config, tiny_backbone  # noqa: E402

UUID = re.compile(rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TOKEN = re.compile(rb"\b[ps]\d{5,6}\b")


@pytest.fixture(scope="module")
def artifact(tmp_path_factory):
    return make_artifact(tmp_path_factory.mktemp("run-artifact"))


@pytest.fixture(scope="module")
def run(artifact, tmp_path_factory):
    base = tmp_path_factory.mktemp("runs")
    summary = train(artifact["root"], smoke_config(), base / "run", backbone=tiny_backbone())
    return {"summary": summary, "root": base / "run", "base": base}


def read(run, name):
    return json.loads((run["root"] / name).read_text("utf-8"))


def test_smoke_run_layout_and_marker(run):
    files = sorted(str(p.relative_to(run["root"])).replace("\\", "/") for p in run["root"].rglob("*") if p.is_file())
    assert files == [
        "RUN_COMPLETE.json", "checkpoints/finetune.best.weights.h5", "checkpoints/head.best.weights.h5",
        "history.json", "model/model.keras", "provenance.json", "runtime.json", "summary.json", "training-config.json",
    ]
    marker = read(run, "RUN_COMPLETE.json")
    for name, digest in marker["files"].items():
        assert hashlib.sha256((run["root"] / name).read_bytes()).hexdigest() == digest
    assert set(marker["files"]) == set(files) - {"RUN_COMPLETE.json"}
    assert not [p for p in run["base"].iterdir() if p.name.startswith(".")]  # no partial directory left


def test_config_and_provenance_records(run, artifact):
    text = (run["root"] / "training-config.json").read_text("utf-8")
    assert hashlib.sha256(text.encode()).hexdigest() == run["summary"]["trainingConfigSha256"]
    config = json.loads(text)
    assert config["artifact"]["artifactSha256"] == artifact["summary"]["artifactSha256"]
    assert config["phases"][1]["optimizer"]["learningRate"] == "0.00001"
    provenance = read(run, "provenance.json")
    assert provenance["trainingRecipeSha256"] == training_recipe_sha256(config)
    assert provenance["inputAdapter"] == "EFFICIENTNETV2_IMAGENET_INPUT_V1"
    assert provenance["runtimeProfile"] == "TRAINING_RUNTIME_V1"
    assert provenance["determinism"]["policy"] == "STRICT" and provenance["determinism"]["opDeterminism"] is True
    assert provenance["weights"] == {"weightSpec": "NONE"}
    runtime = read(run, "runtime.json")
    assert (runtime["tensorflowVersion"], runtime["kerasVersion"], runtime["numpyVersion"]) == ("2.20.0", "3.11.3", "2.1.3")
    assert runtime["devices"] and runtime["determinism"]["policy"] == "STRICT"


def test_history_and_summary(run):
    history = read(run, "history.json")["epochs"]
    assert [(h["phase"], h["epoch"]) for h in history][:2] == [("HEAD", 0), ("HEAD", 1)]
    assert {"loss", "roc_auc", "pr_auc", "accuracy", "precision", "recall"} == set(history[0]["train"])
    assert {"val_loss", "val_roc_auc", "val_pr_auc", "val_accuracy", "val_precision", "val_recall"} == set(history[0]["validation"])
    summary = read(run, "summary.json")
    assert summary["counts"] == {"TRAIN": {"samples": 7, "NORMAL": 4, "ABNORMAL": 3}, "VALIDATION": {"samples": 3, "NORMAL": 1, "ABNORMAL": 2}}
    assert summary["phases"]["HEAD"]["trainableBackboneLayers"] == 0
    assert summary["phases"]["FINE_TUNE"]["trainableBackboneLayers"] == 2  # tiny backbone: block6a conv + top_conv


def test_run_artifacts_contain_no_identifiers_tokens_paths_or_test(run, artifact):
    data = b"".join(p.read_bytes() for p in run["root"].rglob("*.json"))
    assert UUID.search(data) is None
    assert TOKEN.search(data) is None
    for forbidden in (b'"TEST"', b"patientToken", b"sampleToken", b"DICM", b".dcm", str(run["base"]).encode(), str(artifact["root"]).encode(), b"\\\\", b"/home/", b"C:"):
        assert forbidden not in data, forbidden


def test_model_keras_round_trip_without_augmentation(run):
    model = keras.saving.load_model(run["root"] / "model" / "model.keras")
    names = [l.name for l in model.layers]
    assert names[1] == "efficientnetv2_imagenet_input_v1" and not any(n.startswith(("aug_", "train_augmentation")) for n in names)
    x = np.random.default_rng(0).random((2, 224, 224, 3), dtype=np.float32)
    again = keras.saving.load_model(run["root"] / "model" / "model.keras")
    assert np.array_equal(model(x).numpy(), again(x).numpy())
    assert model.output_shape == (None, 1)


def test_two_strict_runs_are_identical_on_cpu(run, artifact):
    second = train(artifact["root"], smoke_config(), run["base"] / "run-2", backbone=tiny_backbone())
    assert second["trainingConfigSha256"] == run["summary"]["trainingConfigSha256"]
    assert read(run, "history.json") == json.loads((run["base"] / "run-2" / "history.json").read_text())
    a = keras.saving.load_model(run["root"] / "model" / "model.keras").get_weights()
    b = keras.saving.load_model(run["base"] / "run-2" / "model" / "model.keras").get_weights()
    assert all(np.array_equal(x, y) for x, y in zip(a, b))


def test_training_never_touches_test(artifact, tmp_path, monkeypatch):
    requested = []
    original_samples, original_split = CloudArtifact.iter_samples, CloudArtifact.iter_split

    def spy_samples(self, split, order=None):
        requested.append(split)
        return original_samples(self, split, order)

    def spy_split(self, split):
        requested.append(split)
        return original_split(self, split)

    monkeypatch.setattr(CloudArtifact, "iter_samples", spy_samples)
    monkeypatch.setattr(CloudArtifact, "iter_split", spy_split)
    train(artifact["root"], smoke_config(), tmp_path / "run", backbone=tiny_backbone())
    assert set(requested) == {"TRAIN", "VALIDATION"}


# --- failures before fitting -----------------------------------------------------------------


def code_of(fn):
    with pytest.raises(TrainingError) as error:
        fn()
    return error.value.code


def test_32x32_artifact_rejected_by_production_contract(tmp_path):
    small = make_small_artifact(tmp_path)
    assert code_of(lambda: train(small["root"], smoke_config(), tmp_path / "run", backbone=tiny_backbone())) == "INCOMPATIBLE_TENSOR_CONTRACT"
    assert not (tmp_path / "run").exists()


def test_validation_with_one_class_rejected(tmp_path):
    from dataset_builder import DEFAULT_ITEMS  # VALIDATION = one NORMAL patient

    one_class = make_artifact(tmp_path, items=DEFAULT_ITEMS)
    assert code_of(lambda: train(one_class["root"], smoke_config(), tmp_path / "run", backbone=tiny_backbone())) == "VALIDATION_CLASS_MISSING"


def test_artifact_failures(artifact, tmp_path):
    copy_root = tmp_path / "artifact"
    shutil.copytree(artifact["root"], copy_root)
    shard = sorted((copy_root / "tensors").iterdir())[0]
    data = bytearray(shard.read_bytes())
    data[-3] ^= 1
    shard.write_bytes(bytes(data))
    assert code_of(lambda: train(copy_root, smoke_config(), tmp_path / "r1", backbone=tiny_backbone())) == "ARTIFACT_INVALID"

    bound = {**smoke_config(), "artifact": {**artifact_binding(CloudArtifact.open(artifact["root"])), "artifactSha256": "0" * 64}}
    assert code_of(lambda: train(artifact["root"], bound, tmp_path / "r2", backbone=tiny_backbone())) == "ARTIFACT_MISMATCH"
    (tmp_path / "exists").mkdir()
    assert code_of(lambda: train(artifact["root"], smoke_config(), tmp_path / "exists", backbone=tiny_backbone())) == "OUTPUT_EXISTS"


def test_runtime_and_determinism_failures(artifact, tmp_path, monkeypatch):
    import childbex_ml.training.train as train_module

    monkeypatch.setattr(train_module, "check_runtime", lambda: (_ for _ in ()).throw(TrainingError("UNSUPPORTED_RUNTIME", "keras")))
    assert code_of(lambda: train(artifact["root"], smoke_config(), tmp_path / "r1", backbone=tiny_backbone())) == "UNSUPPORTED_RUNTIME"
    monkeypatch.undo()

    def unavailable():
        raise RuntimeError("no deterministic kernels")

    monkeypatch.setattr(tf.config.experimental, "enable_op_determinism", unavailable)
    assert code_of(lambda: train(artifact["root"], smoke_config(), tmp_path / "r2", backbone=tiny_backbone())) == "DETERMINISM_UNAVAILABLE"
    assert not [p for p in tmp_path.iterdir() if p.name.startswith((".r", "r"))]


def test_best_effort_is_recorded_prominently(artifact, tmp_path):
    config = smoke_config({"determinism": "BEST_EFFORT"})
    train(artifact["root"], config, tmp_path / "run", backbone=tiny_backbone())
    provenance = json.loads((tmp_path / "run" / "provenance.json").read_text())
    assert provenance["determinism"]["policy"] == "BEST_EFFORT" and "not guaranteed" in provenance["determinism"]["warning"]


def test_weights_spec_resolved_offline_and_recorded(artifact, tmp_path, monkeypatch):
    fetch = fake_weights_fetch(tmp_path)
    monkeypatch.setitem(weights_module.SPECS, SPEC.spec, WeightSpec(SPEC.spec, SPEC.source, SPEC.file_name, SPEC.origin, fetch.md5, "md5"))
    received = []
    tiny = tiny_backbone()
    spec = type(tiny)(build=lambda path: (received.append(path), tiny.build(path))[1], fine_tune_blocks=tiny.fine_tune_blocks)
    config = smoke_config()
    config["model"]["weights"] = SPEC.spec
    train(artifact["root"], config, tmp_path / "run", backbone=spec, weights_fetch=fetch)
    assert received and received[0].endswith(SPEC.file_name)  # explicit local path passed to the backbone
    provenance = json.loads((tmp_path / "run" / "provenance.json").read_text())
    assert provenance["weights"]["weightSpec"] == SPEC.spec and provenance["weights"]["sha256"] == fetch.sha256
    assert str(tmp_path) not in json.dumps(provenance)


def test_class_weighted_run(artifact, tmp_path):
    summary = train(artifact["root"], smoke_config({"classWeighting": "TRAIN_BALANCED_V1"}), tmp_path / "run", backbone=tiny_backbone())
    assert summary["classWeights"] == {"0": 7 / 8, "1": 7 / 6}


def test_single_vs_multi_window_share_the_recipe(tmp_path):
    from childbex_ml.dataset import run_preflight
    from childbex_ml.preprocessing import load_preset as preprocessing_preset
    from cloud_helpers import build, ready_export
    from training_helpers import TRAINING_ITEMS

    export = ready_export(tmp_path, TRAINING_ITEMS, preset="ct-multi-window-v1")
    run_preflight(export["root"], preprocessing_preset("ct-single-window-v1"))
    multi = CloudArtifact.open(build(tmp_path, export, "multi", preset="ct-multi-window-v1")["root"])
    single = CloudArtifact.open(build(tmp_path, export, "single", preset="ct-single-window-v1")["root"])
    config = smoke_config()
    a, b = resolve_config(config, artifact_binding(multi)), resolve_config(config, artifact_binding(single))
    assert a["artifact"]["manifestSha256"] == b["artifact"]["manifestSha256"]  # same PR10 source and splits
    assert a["artifact"]["preprocessingConfigHash"] != b["artifact"]["preprocessingConfigHash"]
    assert training_recipe_sha256(a) == training_recipe_sha256(b)
    assert training_config_sha256(a) != training_config_sha256(b)
    assert [p["patientToken"] for p in multi.manifest["patients"]] == [p["patientToken"] for p in single.manifest["patients"]]
    assert copy.deepcopy(a)["artifact"] != b["artifact"]
