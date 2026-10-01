"""SnapshotDataset: preflight binding, runtime binding, lazy deterministic splits."""

import json
import types

import numpy as np
import pytest

import childbex_ml.dataset.loader as loader_module
from childbex_ml.dataset import DatasetError, SnapshotDataset, run_preflight, runtime_fingerprint
from childbex_ml.preprocessing import config_hash, load_preset, preprocess_dicom_bytes
from dataset_builder import DEFAULT_ITEMS, build_export, patient_key, uid


@pytest.fixture
def multi():
    return load_preset("ct-multi-window-v1")


@pytest.fixture
def ready(tmp_path, multi):
    export = build_export(tmp_path / "e")
    run_preflight(export["root"], multi)
    return export


def open_code(*args, **kwargs) -> str:
    with pytest.raises(DatasetError) as error:
        SnapshotDataset.open(*args, **kwargs)
    return error.value.code


# --- preflight binding ---------------------------------------------------------------------


def test_open_requires_a_preflight(tmp_path, multi):
    export = build_export(tmp_path / "e")
    assert open_code(export["root"], multi) == "PREFLIGHT_REQUIRED"
    # A report for another configuration does not count.
    run_preflight(export["root"], load_preset("ct-single-window-v1"))
    assert open_code(export["root"], multi) == "PREFLIGHT_REQUIRED"


def test_failed_preflight_blocks_training(tmp_path, multi):
    items = [(n, p, s, label, {"modality": "MR"} if n == 4 else kwargs) for n, p, s, label, kwargs in DEFAULT_ITEMS]
    export = build_export(tmp_path / "e", items)
    assert run_preflight(export["root"], multi)["ok"] is False
    assert open_code(export["root"], multi) == "PREFLIGHT_FAILED"


@pytest.mark.parametrize("key", ["childbexMlVersion", "pythonVersion", "numpyVersion", "pydicomVersion", "pythonImplementation"])
def test_runtime_mismatch_makes_the_preflight_stale(ready, multi, monkeypatch, key):
    assert SnapshotDataset.open(ready["root"], multi)
    other = {**runtime_fingerprint(), key: "0.0.0-other"}
    monkeypatch.setattr(loader_module, "runtime_fingerprint", lambda: other)
    assert open_code(ready["root"], multi) == "PREFLIGHT_STALE"


def test_preflight_from_another_runtime_is_stale_until_rerun(ready, multi, monkeypatch):
    # Simulates copying an export (with its report) to a training machine.
    other = {**runtime_fingerprint(), "numpyVersion": "9.9.9"}
    monkeypatch.setattr(loader_module, "runtime_fingerprint", lambda: other)
    assert open_code(ready["root"], multi) == "PREFLIGHT_STALE"
    import childbex_ml.dataset.preflight as preflight_module

    monkeypatch.setattr(preflight_module, "runtime_fingerprint", lambda: other)
    run_preflight(ready["root"], multi)  # preflight again "there"
    assert SnapshotDataset.open(ready["root"], multi).report["runtime"]["numpyVersion"] == "9.9.9"


def test_edited_report_is_stale(ready, multi):
    path = ready["root"] / "preflight" / f"{config_hash(multi)}.json"
    report = json.loads(path.read_text("utf-8"))
    report["manifestSha256"] = "0" * 64
    path.write_text(json.dumps(report), "utf-8")
    assert open_code(ready["root"], multi) == "PREFLIGHT_STALE"
    report = json.loads(path.read_text("utf-8"))
    report["manifestSha256"] = ready["sha256"]
    report["preflightIdentity"] = "f" * 64
    path.write_text(json.dumps(report), "utf-8")
    assert open_code(ready["root"], multi) == "PREFLIGHT_STALE"


def test_extra_file_after_preflight_blocks_open(ready, multi):
    (ready["root"] / "dicom" / f"{uid('3', 77)}.dcm").write_bytes(b"x")
    assert open_code(ready["root"], multi) == "UNEXPECTED_EXPORT_FILE"


# --- iteration -------------------------------------------------------------------------------


def test_labels_are_explicitly_encoded(ready, multi):
    dataset = SnapshotDataset.open(ready["root"], multi)
    assert dataset.label_encoding == {"NORMAL": 0, "ABNORMAL": 1}
    samples = list(dataset.iter_split("TRAIN"))
    assert {(s.label, s.label_index) for s in samples} == {("NORMAL", 0), ("ABNORMAL", 1)}
    assert all(s.label_index == {"NORMAL": 0, "ABNORMAL": 1}[s.label] for s in samples)


@pytest.mark.parametrize(("split", "ids"), [("TRAIN", [1, 2, 3, 4, 5, 6, 7]), ("VALIDATION", [8]), ("TEST", [9])])
def test_each_split_returns_only_its_items_in_canonical_order(ready, multi, split, ids):
    dataset = SnapshotDataset.open(ready["root"], multi)
    samples = list(dataset.iter_split(split))
    assert [s.patient_image_id for s in samples] == [uid("3", n) for n in ids]
    assert {s.split for s in samples} == {split}
    for s in samples:
        assert s.tensor.shape == (224, 224, 3) and s.tensor.dtype == np.float32
        assert s.tensor.min() >= 0.0 and s.tensor.max() <= 1.0
    keys = [(s.patient_group_key, s.series_id, s.series_order_index, s.patient_image_id) for s in samples]
    assert keys == sorted(keys)


def test_no_patient_in_two_splits(ready, multi):
    dataset = SnapshotDataset.open(ready["root"], multi)
    seen = {}
    for split in ("TRAIN", "VALIDATION", "TEST"):
        for item in dataset.items(split):
            assert seen.setdefault(item.patient_group_key, split) == split
    assert {item.label for item in dataset.items("TRAIN") if item.patient_group_key == patient_key(1)} == {"NORMAL", "ABNORMAL"}


def test_iteration_is_deterministic_and_matches_canonical_preprocessing(ready, multi):
    dataset = SnapshotDataset.open(ready["root"], multi)
    first = [(s.patient_image_id, s.tensor.tobytes()) for s in dataset.iter_split("TRAIN")]
    second = [(s.patient_image_id, s.tensor.tobytes()) for s in dataset.iter_split("TRAIN")]
    assert first == second
    image_id, tensor_bytes = first[0]
    data = (ready["root"] / "dicom" / f"{image_id}.dcm").read_bytes()
    assert preprocess_dicom_bytes(data, multi).tensor.tobytes() == tensor_bytes


def test_iteration_is_lazy_one_item_at_a_time(ready, multi):
    calls = []

    def counting(data, config):
        calls.append(1)
        return preprocess_dicom_bytes(data, config)

    dataset = SnapshotDataset.open(ready["root"], multi, preprocess=counting)
    iterator = dataset.iter_split("TRAIN")
    assert isinstance(iterator, types.GeneratorType)
    assert calls == []  # nothing preprocessed before the first sample is requested
    next(iterator)
    assert len(calls) == 1
    next(iterator)
    assert len(calls) == 2
    assert dataset.count("TRAIN") == 7  # counts come from the manifest, not from preprocessing


def test_any_error_aborts_iteration(ready, multi):
    dataset = SnapshotDataset.open(ready["root"], multi)
    path = ready["root"] / "dicom" / f"{uid('3', 2)}.dcm"
    data = bytearray(path.read_bytes())
    data[-1] ^= 0xFF
    path.write_bytes(bytes(data))  # changed after preflight
    iterator = dataset.iter_split("TRAIN")
    assert next(iterator).patient_image_id == uid("3", 1)
    with pytest.raises(DatasetError) as error:
        next(iterator)
    assert (error.value.code, error.value.patient_image_id) == ("FILE_INTEGRITY_MISMATCH", uid("3", 2))
    with pytest.raises(StopIteration):
        next(iterator)


def test_unknown_split_rejected(ready, multi):
    with pytest.raises(ValueError):
        SnapshotDataset.open(ready["root"], multi).iter_split("HOLDOUT")


def test_sample_repr_has_no_tensor_or_identifying_data(ready, multi):
    sample = next(SnapshotDataset.open(ready["root"], multi).iter_split("TEST"))
    text = repr(sample)
    assert "tensor" not in text and "SENTINEL" not in text
