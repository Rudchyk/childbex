"""Preflight: every item processed, all failures reported, identity binding."""

import json

import numpy as np
import pytest

from childbex_ml.dataset import DatasetError, preflight_identity, run_preflight, runtime_fingerprint
from childbex_ml.preprocessing import config_hash, load_preset, preprocess_dicom_bytes
from dataset_builder import DEFAULT_ITEMS, build_export, dicom_for, uid
from synthetic import (
    JPEGLosslessSV1,
    SENTINEL_NAME,
    SENTINEL_PATIENT_ID,
    SENTINEL_SERIES_UID,
    SENTINEL_SOP_UID,
    SENTINEL_STUDY_UID,
)

@pytest.fixture
def multi():
    return load_preset("ct-multi-window-v1")


def items_with(changes: dict[int, dict]):
    return [(n, p, s, label, changes.get(n, kwargs)) for n, p, s, label, kwargs in DEFAULT_ITEMS]


def test_clean_export_passes_and_every_item_is_processed(tmp_path, multi):
    export = build_export(tmp_path / "e")
    calls = []

    def counting(data, config):
        calls.append(data)
        return preprocess_dicom_bytes(data, config)

    report = run_preflight(export["root"], multi, preprocess=counting)
    assert len(calls) == 9
    assert report["ok"] is True
    assert (report["totalItems"], report["passedItems"], report["failedItems"]) == (9, 9, 0)
    assert report["bySplit"] == {
        "TRAIN": {"items": 7, "passed": 7, "failed": 0},
        "VALIDATION": {"items": 1, "passed": 1, "failed": 0},
        "TEST": {"items": 1, "passed": 1, "failed": 0},
    }
    assert report["labelEncoding"] == {"NORMAL": 0, "ABNORMAL": 1}
    assert report["preprocessing"]["configHash"] == config_hash(multi)
    stored = json.loads((export["root"] / "preflight" / f"{config_hash(multi)}.json").read_text("utf-8"))
    assert stored == report


def test_multiple_different_failures_are_all_reported(tmp_path, multi):
    export = build_export(
        tmp_path / "e",
        items_with(
            {
                2: {"transfer_syntax": JPEGLosslessSV1},  # encapsulated by the fixture
                5: {"slope": None},
                8: {"modality": "MR"},
                9: {"intercept": [-1024, 0]},
            }
        ),
    )
    report = run_preflight(export["root"], multi)
    assert report["ok"] is False
    assert (report["totalItems"], report["passedItems"], report["failedItems"]) == (9, 5, 4)
    assert report["failuresByCode"] == {
        "INVALID_CT_RESCALE": 1,
        "MISSING_CT_RESCALE": 1,
        "UNSUPPORTED_MODALITY": 1,
        "UNSUPPORTED_TRANSFER_SYNTAX": 1,
    }
    assert report["failures"] == [
        {"patientImageId": uid("3", 2), "split": "TRAIN", "code": "UNSUPPORTED_TRANSFER_SYNTAX"},
        {"patientImageId": uid("3", 5), "split": "TRAIN", "code": "MISSING_CT_RESCALE"},
        {"patientImageId": uid("3", 8), "split": "VALIDATION", "code": "UNSUPPORTED_MODALITY"},
        {"patientImageId": uid("3", 9), "split": "TEST", "code": "INVALID_CT_RESCALE"},
    ]
    assert report["bySplit"]["TRAIN"] == {"items": 7, "passed": 5, "failed": 2}


def test_same_size_tampered_file_is_detected(tmp_path, multi):
    export = build_export(tmp_path / "e")
    path = export["root"] / "dicom" / f"{uid('3', 4)}.dcm"
    data = bytearray(path.read_bytes())
    data[-1] ^= 0xFF
    path.write_bytes(bytes(data))
    report = run_preflight(export["root"], multi)
    assert report["failures"] == [{"patientImageId": uid("3", 4), "split": "TRAIN", "code": "FILE_INTEGRITY_MISMATCH"}]


def test_missing_file_stops_at_folder_level(tmp_path, multi):
    export = build_export(tmp_path / "e")
    (export["root"] / "dicom" / f"{uid('3', 6)}.dcm").unlink()
    with pytest.raises(DatasetError) as error:
        run_preflight(export["root"], multi)
    assert error.value.code == "FILE_MISSING"
    assert error.value.failures == [{"patientImageId": uid("3", 6), "code": "FILE_MISSING"}]
    assert not (export["root"] / "preflight").exists()


class _Fake:
    def __init__(self, tensor):
        self.tensor = tensor


@pytest.mark.parametrize(
    "tensor",
    [
        np.zeros((224, 224, 1), np.float32),  # shape
        np.zeros((223, 224, 3), np.float32),
        np.zeros((224, 224, 3), np.float64),  # dtype
        np.zeros((224, 224, 3), np.float16),
        np.full((224, 224, 3), np.nan, np.float32),  # NaN
        np.full((224, 224, 3), np.inf, np.float32),  # Inf
        np.full((224, 224, 3), 1.0001, np.float32),  # range
        np.full((224, 224, 3), -0.0001, np.float32),
        [[0.0]],  # not an array
    ],
)
def test_tensor_contract_is_enforced(tmp_path, multi, tensor):
    export = build_export(tmp_path / "e")

    def broken_for_item_7(data, config):
        result = preprocess_dicom_bytes(data, config)
        return _Fake(tensor) if data == dicom_for(7) else result

    report = run_preflight(export["root"], multi, preprocess=broken_for_item_7)
    assert report["failures"] == [{"patientImageId": uid("3", 7), "split": "TRAIN", "code": "TENSOR_CONTRACT_VIOLATION"}]


def test_unexpected_exception_is_reported_not_skipped(tmp_path, multi):
    export = build_export(tmp_path / "e")

    def crash_on_item_1(data, config):
        if data == dicom_for(1):
            raise RuntimeError("SENTINEL crash with /some/path")
        return preprocess_dicom_bytes(data, config)

    report = run_preflight(export["root"], multi, preprocess=crash_on_item_1)
    assert report["failures"] == [{"patientImageId": uid("3", 1), "split": "TRAIN", "code": "PREPROCESSING_FAILED"}]
    assert "SENTINEL" not in json.dumps(report)


# --- identity -----------------------------------------------------------------------------------


def test_identity_is_deterministic_and_excludes_timestamps(tmp_path, multi):
    export = build_export(tmp_path / "e")
    first = run_preflight(export["root"], multi)
    second = run_preflight(export["root"], multi)
    assert first["preflightIdentity"] == second["preflightIdentity"]
    assert first["preflightIdentity"] == preflight_identity(
        first["snapshotId"], first["manifestSha256"], config_hash(multi), runtime_fingerprint()
    )


def test_identity_binds_preset_manifest_and_runtime(tmp_path, multi):
    export = build_export(tmp_path / "e")
    runtime = runtime_fingerprint()
    base = preflight_identity("s", "m" * 64, config_hash(multi), runtime)
    single = load_preset("ct-single-window-v1")
    assert preflight_identity("s", "m" * 64, config_hash(single), runtime) != base
    assert preflight_identity("s", "n" * 64, config_hash(multi), runtime) != base
    assert preflight_identity("t", "m" * 64, config_hash(multi), runtime) != base
    for key in runtime:
        changed = {**runtime, key: runtime[key] + "-other"}
        assert preflight_identity("s", "m" * 64, config_hash(multi), changed) != base

    a = run_preflight(export["root"], multi)
    b = run_preflight(export["root"], single)
    assert a["preflightIdentity"] != b["preflightIdentity"]
    assert sorted(p.name for p in (export["root"] / "preflight").iterdir()) == sorted(
        [f"{config_hash(multi)}.json", f"{config_hash(single)}.json"]
    )


def test_changed_file_hash_changes_manifest_and_identity(tmp_path, multi):
    a = build_export(tmp_path / "a")
    b = build_export(tmp_path / "b", items_with({3: {"intercept": -1000}}))
    ra, rb = run_preflight(a["root"], multi), run_preflight(b["root"], multi)
    assert ra["manifestSha256"] != rb["manifestSha256"]
    assert ra["preflightIdentity"] != rb["preflightIdentity"]


def test_report_dir_override(tmp_path, multi):
    export = build_export(tmp_path / "e")
    report = run_preflight(export["root"], multi, report_dir=tmp_path / "reports")
    assert (tmp_path / "reports" / f"{report['preprocessing']['configHash']}.json").is_file()
    assert not (export["root"] / "preflight").exists()


def test_report_contains_no_identifying_data(tmp_path, multi):
    export = build_export(tmp_path / "SENTINEL_DIR")
    report = run_preflight(export["root"], multi)
    text = json.dumps(report)
    for forbidden in (SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_STUDY_UID, SENTINEL_SERIES_UID, SENTINEL_SOP_UID,
                      "SENTINEL", str(tmp_path), ".dcm", "1.2.840.10008"):
        assert forbidden not in text
