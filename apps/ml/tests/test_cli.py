"""Reference CLI: structured output, exit codes, no PHI / UIDs / paths."""

import json
import subprocess
import sys

import numpy as np
import pytest

from synthetic import (
    SENTINEL_FILE_NAME,
    SENTINEL_NAME,
    SENTINEL_PATIENT_ID,
    SENTINEL_SERIES_UID,
    SENTINEL_SOP_UID,
    SENTINEL_STUDY_UID,
    ct_bytes,
    ct_dataset,
    to_bytes,
)
from test_config import MULTI_HASH, SINGLE_HASH


def run(*args):
    completed = subprocess.run(
        [sys.executable, "-m", "childbex_ml.preprocessing", *map(str, args)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    return completed.returncode, completed.stdout, completed.stderr


def assert_no_identifiers(text: str, directory):
    for value in [
        SENTINEL_NAME,
        "SENTINEL",
        SENTINEL_PATIENT_ID,
        SENTINEL_STUDY_UID,
        SENTINEL_SERIES_UID,
        SENTINEL_SOP_UID,
        "1.2.826.0.1.3680043.10.4242",
        "1.2.840.10008",  # not even standard UIDs
        SENTINEL_FILE_NAME,
        str(directory),
        directory.name,
    ]:
        assert value not in text


@pytest.fixture
def dicom_dir(tmp_path):
    directory = tmp_path / "SENTINEL_DIR_2c9e"
    directory.mkdir()
    return directory


def write(directory, data: bytes):
    path = directory / SENTINEL_FILE_NAME
    path.write_bytes(data)
    return path


def test_inspect_supported(dicom_dir):
    stored = np.full((64, 64), 1024 + 40, dtype=np.int16)
    stored[0, 0] = 1024 + 3071
    path = write(dicom_dir, ct_bytes(stored, pixel_spacing=(0.5, 1.0)))
    code, out, err = run("inspect", path, "--preset", "ct-multi-window-v1")
    assert code == 0, err
    result = json.loads(out)
    assert result == {
        "supported": True,
        "errorCode": None,
        "modality": "CT",
        "rows": 64,
        "columns": 64,
        "transferSyntax": "EXPLICIT_VR_LE",
        "huMin": 40.0,
        "huMax": 3071.0,
        "paddingPixelCount": 0,
        "tensorShape": [224, 224, 3],
        "tensorDtype": "float32",
        "tensorMin": 0.0,
        "tensorMax": 1.0,
        "contentBox": {"top": 56, "left": 0, "height": 112, "width": 224},
        "preprocessingSchemaVersion": 1,
        "configHash": MULTI_HASH,
        "packageVersion": result["packageVersion"],
    }
    assert_no_identifiers(out + err, dicom_dir)


def test_inspect_unsupported_reports_code_only(dicom_dir):
    path = write(dicom_dir, ct_bytes(modality="MR"))
    code, out, err = run("inspect", path, "--preset", "ct-single-window-v1")
    assert code == 2
    result = json.loads(out)
    assert result["supported"] is False
    assert result["errorCode"] == "UNSUPPORTED_MODALITY"
    assert result["modality"] == "MR"
    assert result["configHash"] == SINGLE_HASH
    assert result["tensorShape"] is None
    assert_no_identifiers(out + err, dicom_dir)


@pytest.mark.filterwarnings("ignore::UserWarning")  # the fixture itself is malformed
def test_inspect_with_invalid_values_leaks_nothing(dicom_dir):
    # Malformed values that pydicom would warn about, quoting them.
    ds = ct_dataset()
    ds.add_new(0x00100030, "DA", "SENTINEL_BAD_DATE")
    ds.add_new(0x00081030, "LO", "SENTINEL" * 20)
    ds.Modality = "SENTINEL MODALITY TEXT"
    path = write(dicom_dir, to_bytes(ds))
    code, out, err = run("inspect", path, "--preset", "ct-multi-window-v1")
    assert code == 2
    assert json.loads(out)["modality"] == "INVALID"
    assert_no_identifiers(out + err, dicom_dir)


def test_not_dicom_and_missing_file(dicom_dir):
    path = write(dicom_dir, b"SENTINEL" * 100)
    code, out, err = run("inspect", path, "--preset", "ct-multi-window-v1")
    assert code == 2 and json.loads(out)["errorCode"] == "NOT_DICOM"
    assert_no_identifiers(out + err, dicom_dir)

    code, out, err = run("inspect", dicom_dir / "SENTINEL_missing.dcm", "--preset", "ct-multi-window-v1")
    assert code == 1 and out == ""
    assert_no_identifiers(out + err, dicom_dir)


def test_usage_errors_do_not_echo_arguments(dicom_dir):
    for args in (
        ["inspect", dicom_dir / "SENTINEL.dcm"],  # no config
        ["inspect", dicom_dir / "SENTINEL.dcm", "--preset", "SENTINEL"],
        ["SENTINEL"],
    ):
        code, out, err = run(*args)
        assert code == 1 and out == ""
        assert_no_identifiers(out + err, dicom_dir)


def test_config_hash_and_custom_config(dicom_dir):
    code, out, _ = run("config-hash", "--preset", "ct-multi-window-v1", "--show")
    payload = json.loads(out)
    assert code == 0 and payload["configHash"] == MULTI_HASH
    assert [w["name"] for w in payload["config"]["windows"]] == ["soft_tissue", "lung", "bone"]

    custom = payload["config"]
    custom["windows"].reverse()
    config_path = dicom_dir / "config.json"
    config_path.write_text(json.dumps(custom))
    code, out, _ = run("config-hash", "--config", config_path)
    assert code == 0 and json.loads(out)["configHash"] not in (MULTI_HASH, SINGLE_HASH)

    custom["extra"] = True
    config_path.write_text(json.dumps(custom))
    code, out, err = run("config-hash", "--config", config_path)
    assert code == 1 and "unknown keys: extra" in err
    assert_no_identifiers(out + err, dicom_dir)
