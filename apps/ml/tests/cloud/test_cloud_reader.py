"""NumPy-only reader: validation, exact file set, shard checks, identity."""

import copy
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

import childbex_ml.cloud_artifact.npy as npy_module
from childbex_ml.cloud_artifact import CloudArtifact, CloudArtifactError, artifact_sha256
from cloud_helpers import build, ready_export, reseal


@pytest.fixture(scope="module")
def artifact_dir(tmp_path_factory):
    base = tmp_path_factory.mktemp("cloud")
    return build(base, ready_export(base), shard_size=4)["root"]


@pytest.fixture
def artifact(artifact_dir, tmp_path):
    copy_dir = tmp_path / "artifact"
    shutil.copytree(artifact_dir, copy_dir)
    return copy_dir


def open_code(root, **kwargs):
    with pytest.raises(CloudArtifactError) as error:
        CloudArtifact.open(root, **kwargs)
    return error.value


def test_open_verify_and_deterministic_iteration(artifact):
    opened = CloudArtifact.open(artifact)
    assert opened.verify()["verifiedSamples"] == 9
    for split, expected in (("TRAIN", 7), ("VALIDATION", 1), ("TEST", 1)):
        first = [(s.sample_token, s.patient_token, s.label, s.label_index, s.tensor.tobytes()) for s in opened.iter_split(split)]
        second = [(s.sample_token, s.patient_token, s.label, s.label_index, s.tensor.tobytes()) for s in opened.iter_split(split)]
        assert first == second and len(first) == expected == opened.count(split)
        manifest_order = [s["sampleToken"] for s in opened.manifest["samples"] if s["split"] == split]
        assert [f[0] for f in first] == manifest_order  # no shuffling
        assert all(f[3] == {"NORMAL": 0, "ABNORMAL": 1}[f[2]] for f in first)
    sample = next(opened.iter_split("TEST"))
    assert sample.tensor.dtype == np.float32 and sample.tensor.shape == (224, 224, 3)
    with pytest.raises(ValueError):
        opened.iter_split("HOLDOUT")


def test_reader_loads_with_allow_pickle_false(artifact, monkeypatch):
    calls = []
    real = np.load

    def recording(*args, **kwargs):
        calls.append(kwargs.get("allow_pickle"))
        return real(*args, **kwargs)

    monkeypatch.setattr(npy_module.np, "load", recording)
    list(CloudArtifact.open(artifact).iter_split("TRAIN"))
    assert calls and all(value is False for value in calls)


def test_reader_needs_no_pydicom(artifact):
    code = (
        "import sys; sys.modules['pydicom'] = None\n"
        "from childbex_ml.cloud_artifact import CloudArtifact\n"
        f"a = CloudArtifact.open({str(artifact)!r}); print(a.verify()['verifiedSamples'])\n"
        "assert 'childbex_ml.preprocessing' not in sys.modules and 'childbex_ml.dataset' not in sys.modules\n"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "9"


# --- corruption / file set -----------------------------------------------------------


def first_shard(root):
    return sorted((root / "tensors").iterdir())[0]


def test_corrupted_tensor_is_detected(artifact):
    path = first_shard(artifact)
    data = bytearray(path.read_bytes())
    data[-5] ^= 0x01
    path.write_bytes(bytes(data))
    assert open_code(artifact).code == "SHARD_HASH_MISMATCH"
    lazy = CloudArtifact.open(artifact, verify_shards=False)
    with pytest.raises(CloudArtifactError) as error:
        list(lazy.iter_split(path.name.split("-")[0]))
    assert error.value.code == "TENSOR_HASH_MISMATCH"


@pytest.mark.parametrize("where", ["top", "tensors", "tensors-dir"])
def test_unexpected_files_rejected(artifact, where):
    if where == "top":
        (artifact / "notes.txt").write_text("x")
    elif where == "tensors":
        (artifact / "tensors" / "TRAIN-00002.npy").write_bytes(b"x")
    else:
        (artifact / "tensors" / "extra").mkdir()
    error = open_code(artifact)
    assert error.code == "UNEXPECTED_ARTIFACT_FILE" and error.count == 1


def test_missing_shard_and_readme_rejected(artifact):
    first_shard(artifact).unlink()
    assert open_code(artifact).code == "ARTIFACT_FILE_MISSING"


def test_missing_readme_rejected(artifact):
    (artifact / "README-SENSITIVE.txt").unlink()
    assert open_code(artifact).code == "ARTIFACT_FILE_MISSING"


def test_directory_in_place_of_a_shard_rejected(artifact):
    path = first_shard(artifact)
    path.unlink()
    path.mkdir()
    assert open_code(artifact).code == "ARTIFACT_FILE_NOT_REGULAR"


def test_symlinked_shard_rejected(artifact, tmp_path):
    path = first_shard(artifact)
    outside = tmp_path / "outside.npy"
    shutil.copyfile(path, outside)
    path.unlink()
    try:
        os.symlink(outside, path)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not permitted in this environment")
    assert open_code(artifact).code == "ARTIFACT_FILE_NOT_REGULAR"


def test_symlinked_shard_rejected_without_following(artifact, monkeypatch):
    """Platform-independent: a symlink entry is rejected even if it points to a valid shard."""
    import childbex_ml.cloud_artifact.reader as reader_module

    victim = first_shard(artifact).name
    real_scandir = os.scandir

    class Entry:
        def __init__(self, entry):
            self.name, self.path = entry.name, entry.path

        def is_symlink(self):
            return True

        def is_file(self, *, follow_symlinks=True):
            return follow_symlinks

    class Entries:
        def __init__(self, path):
            self._inner = real_scandir(path)

        def __enter__(self):
            return (Entry(e) if e.name == victim else e for e in self._inner)

        def __exit__(self, *exc):
            self._inner.close()

    monkeypatch.setattr(reader_module.os, "scandir", Entries)
    assert open_code(artifact).code == "ARTIFACT_FILE_NOT_REGULAR"


@pytest.mark.parametrize(
    "replacement",
    [
        lambda shape: b"\x93NUMPY garbage",  # malformed header
        lambda shape: np.zeros(shape, dtype="<f8"),  # dtype
        lambda shape: np.zeros(shape, dtype=">f4"),  # byte order
        lambda shape: np.zeros((shape[0], 224, 224, 1), dtype="<f4"),  # shape
        lambda shape: np.asfortranarray(np.zeros(shape, dtype="<f4")),  # order
        lambda shape: np.array([{"a": 1}] * shape[0], dtype=object),  # pickled objects
    ],
)
def test_invalid_shards_rejected(artifact, replacement):
    path = first_shard(artifact)
    shape = np.load(path, mmap_mode="r", allow_pickle=False).shape
    value = replacement(shape)
    if isinstance(value, bytes):
        path.write_bytes(value)
    else:
        with open(path, "wb") as stream:
            np.save(stream, value, allow_pickle=True)
    assert open_code(artifact).code == "INVALID_SHARD"


# --- manifest / marker ------------------------------------------------------------------


def test_marker_checks(artifact):
    marker = json.loads((artifact / "CLOUD_ARTIFACT_COMPLETE.json").read_text())
    (artifact / "CLOUD_ARTIFACT_COMPLETE.json").write_text(json.dumps({**marker, "sampleCount": 8}))
    assert open_code(artifact).code == "ARTIFACT_MARKER_MISMATCH"
    (artifact / "CLOUD_ARTIFACT_COMPLETE.json").write_text(json.dumps({**marker, "artifactSha256": "0" * 64}))
    assert open_code(artifact).code == "ARTIFACT_HASH_MISMATCH"
    (artifact / "CLOUD_ARTIFACT_COMPLETE.json").unlink()
    assert open_code(artifact).code == "ARTIFACT_INCOMPLETE"


def test_unsealed_manifest_change_is_detected(artifact):
    manifest = json.loads((artifact / "manifest.json").read_text())
    manifest["samples"][0]["label"] = "ABNORMAL" if manifest["samples"][0]["label"] == "NORMAL" else "NORMAL"
    (artifact / "manifest.json").write_text(json.dumps(manifest))
    assert open_code(artifact).code in ("ARTIFACT_HASH_MISMATCH", "INVALID_ARTIFACT_MANIFEST", "COUNT_MISMATCH")


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        # Leakage: one sample of a TRAIN patient moved to TEST (shard kept).
        (lambda m: m["samples"][0].__setitem__("split", "TEST"), "SPLIT_INTEGRITY_ERROR"),
        # The same patient token listed in two splits.
        (lambda m: m["patients"].append({"patientToken": m["patients"][0]["patientToken"], "split": "TEST"}), "SPLIT_INTEGRITY_ERROR"),
        (lambda m: m["samples"][0].__setitem__("patientToken", "p99999"), "SPLIT_INTEGRITY_ERROR"),
        (lambda m: m["samples"][1].__setitem__("sampleToken", m["samples"][0]["sampleToken"]), "DUPLICATE_SAMPLE"),
        (lambda m: m["samples"][1].__setitem__("index", m["samples"][0]["index"]), "DUPLICATE_SAMPLE"),
        (lambda m: m["counts"]["TRAIN"].__setitem__("samples", 8), "COUNT_MISMATCH"),
        (lambda m: m["samples"][0].__setitem__("labelIndex", 1 - m["samples"][0]["labelIndex"]), "INVALID_ARTIFACT_MANIFEST"),
        (lambda m: m["samples"][0].__setitem__("patientImageId", "x"), "INVALID_ARTIFACT_MANIFEST"),
        (lambda m: m["source"].__setitem__("snapshotId", "x"), "INVALID_ARTIFACT_MANIFEST"),
        (lambda m: m["privacy"].__setitem__("containsDicom", True), "INVALID_ARTIFACT_MANIFEST"),
        (lambda m: m["privacy"].__setitem__("classification", "ANONYMOUS"), "INVALID_ARTIFACT_MANIFEST"),
        (lambda m: m["tensor"].__setitem__("byteOrder", "big"), "INVALID_ARTIFACT_MANIFEST"),
        (lambda m: m.__setitem__("artifactSchemaVersion", 2), "INVALID_ARTIFACT_MANIFEST"),
    ],
)
def test_resealed_invalid_manifests_rejected(artifact, mutate, code):
    reseal(artifact, mutate)
    assert open_code(artifact, verify_shards=False).code == code


def test_identity_changes_with_every_semantic_field(artifact):
    manifest = json.loads((artifact / "manifest.json").read_text())
    base = artifact_sha256(manifest)

    def changed(fn):
        m = copy.deepcopy(manifest)
        fn(m)
        return artifact_sha256(m)

    mutations = {
        "tensor": lambda m: m["samples"][0].__setitem__("tensorSha256", "0" * 64),
        "position": lambda m: (m["samples"][0].__setitem__("index", 1), m["samples"][1].__setitem__("index", 0)),
        "label": lambda m: m["samples"][0].__setitem__("label", "ABNORMAL"),
        "split": lambda m: m["samples"][0].__setitem__("split", "TEST"),
        "patient token": lambda m: m["samples"][0].__setitem__("patientToken", "p00099"),
        "sample token": lambda m: m["samples"][0].__setitem__("sampleToken", "s999999"),
        "shard membership": lambda m: m["samples"][0].__setitem__("shard", "tensors/TRAIN-00001.npy"),
        "shard order": lambda m: m["shards"].reverse(),
        "sample order": lambda m: m["samples"].reverse(),
    }
    for name, fn in mutations.items():
        assert changed(fn) != base, name
