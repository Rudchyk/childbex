"""Dataset CLI: exit codes and output without paths, file names, UIDs, PHI."""

import json
import subprocess
import sys

import pytest

from dataset_builder import DEFAULT_ITEMS, SNAPSHOT_ID, build_export, uid
from synthetic import SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_SERIES_UID, SENTINEL_SOP_UID, SENTINEL_STUDY_UID


def run(*args):
    completed = subprocess.run(
        [sys.executable, "-m", "childbex_ml.dataset", *map(str, args)], capture_output=True, text=True, timeout=300
    )
    return completed.returncode, completed.stdout, completed.stderr


def assert_clean(text: str, directory):
    for value in (SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_STUDY_UID, SENTINEL_SERIES_UID, SENTINEL_SOP_UID,
                  "SENTINEL", str(directory), directory.name, ".dcm", "1.2.840.10008"):
        assert value not in text


@pytest.fixture
def root(tmp_path):
    return build_export(tmp_path / "SENTINEL_EXPORT_DIR")["root"]


def test_inspect(root):
    code, out, err = run("inspect", "--root", root)
    assert code == 0, err
    payload = json.loads(out)
    assert payload["ok"] is True and payload["snapshotId"] == SNAPSHOT_ID
    assert payload["bySplit"] == {
        "TRAIN": {"patients": 4, "images": 7, "NORMAL": 4, "ABNORMAL": 3},
        "VALIDATION": {"patients": 1, "images": 1, "NORMAL": 1, "ABNORMAL": 0},
        "TEST": {"patients": 1, "images": 1, "NORMAL": 0, "ABNORMAL": 1},
    }
    assert payload["patientsInMoreThanOneSplit"] == 0
    assert "not de-identified" in err
    assert_clean(out + err, root)


def test_preflight_pass_and_fail(tmp_path, root):
    code, out, err = run("preflight", "--root", root, "--preset", "ct-multi-window-v1")
    assert code == 0, err
    assert json.loads(out)["ok"] is True
    assert_clean(out + err, root)

    items = [(n, p, s, label, {"modality": "MR"} if n in (3, 9) else kwargs) for n, p, s, label, kwargs in DEFAULT_ITEMS]
    bad = build_export(tmp_path / "SENTINEL_BAD", items)["root"]
    code, out, err = run("preflight", "--root", bad, "--preset", "ct-single-window-v1")
    payload = json.loads(out)
    assert code == 2 and payload["ok"] is False
    assert payload["failures"] == [
        {"patientImageId": uid("3", 3), "split": "TRAIN", "code": "UNSUPPORTED_MODALITY"},
        {"patientImageId": uid("3", 9), "split": "TEST", "code": "UNSUPPORTED_MODALITY"},
    ]
    assert_clean(out + err, bad)


def test_folder_errors_report_codes_only(root):
    (root / "dicom" / "SENTINEL_Doe_John.dcm").write_bytes(b"x")
    code, out, err = run("inspect", "--root", root)
    assert code == 2
    assert json.loads(out) == {"ok": False, "errorCode": "UNEXPECTED_EXPORT_FILE", "detail": None, "count": 1, "failures": []}
    assert_clean(out + err, root)


def test_usage_and_missing_root_do_not_echo_paths(tmp_path):
    missing = tmp_path / "SENTINEL_missing"
    for args in (["inspect"], ["preflight", "--root", missing], ["SENTINEL"], ["preflight", "--root", missing, "--preset", "SENTINEL"]):
        code, out, err = run(*args)
        assert code == 1
        assert_clean(out + err, tmp_path)
    code, out, err = run("inspect", "--root", missing)
    assert code == 2 and json.loads(out)["errorCode"] == "EXPORT_INCOMPLETE"
    assert_clean(out + err, tmp_path)
