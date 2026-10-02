"""Training CLI: runtime check, hashes, early rejection; no paths in output."""

import json
import subprocess
import sys

import pytest

from training_helpers import make_artifact, make_small_artifact


def run(*args):
    result = subprocess.run([sys.executable, "-m", "childbex_ml.training", *map(str, args)], capture_output=True, text=True, timeout=600)
    return result.returncode, result.stdout, result.stderr


def test_check_runtime():
    pytest.importorskip("tensorflow")
    code, out, _ = run("check-runtime")
    payload = json.loads(out)
    assert code == 0 and payload["runtimeProfile"] == "TRAINING_RUNTIME_V1"
    assert payload["versions"]["tensorflow"] == "2.20.0" and payload["versions"]["keras"] == "3.11.3"


def test_config_hash(tmp_path):
    code, out, _ = run("config-hash", "--preset", "efficientnetv2b0-baseline-v1")
    assert code == 0 and len(json.loads(out)["trainingRecipeSha256"]) == 64
    artifact = make_artifact(tmp_path)
    code, out, err = run("config-hash", "--preset", "efficientnetv2b0-baseline-v1", "--artifact", artifact["root"])
    payload = json.loads(out)
    assert code == 0 and payload["artifactSha256"] == artifact["summary"]["artifactSha256"]
    assert str(tmp_path) not in out + err


def test_train_rejects_before_fitting_without_echoing_paths(tmp_path):
    pytest.importorskip("tensorflow")
    small = make_small_artifact(tmp_path / "SENTINEL_DIR")
    config = tmp_path / "config.json"
    from training_helpers import smoke_config

    config.write_text(json.dumps(smoke_config()))
    code, out, err = run("train", "--artifact", small["root"], "--config", config, "--output", tmp_path / "run")
    assert code == 2 and json.loads(out)["errorCode"] == "INCOMPATIBLE_TENSOR_CONTRACT"
    assert "SENTINEL_DIR" not in out + err and str(tmp_path) not in out + err
    code, out, err = run("train", "--artifact", tmp_path / "SENTINEL_missing")
    assert code == 1 and out == "" and "SENTINEL" not in err


def test_colab_notebook_is_thin_and_never_touches_test():
    from pathlib import Path

    notebook = json.loads((Path(__file__).resolve().parents[2] / "notebooks" / "childbex_training_colab.ipynb").read_text("utf-8"))
    code = "\n".join("".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code")
    assert "train(ARTIFACT_DIR" in code and "check_runtime()" in code and "CloudArtifact.open" in code
    for forbidden in ('"TEST"', "'TEST'", ".verify(", "iter_split", "predict(", "model.fit", "compile(", "drive.mount", "files.upload", "gsutil", "requests."):
        assert forbidden not in code, forbidden
    assert 'tensorflow==2.20.0' in code and 'keras==3.11.3' in code and 'numpy==2.1.3' in code
