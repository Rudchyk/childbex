"""Cloud artifact CLI: exit codes; no paths, UIDs, identifiers, reviewer or attestation contents."""

import json
import subprocess
import sys

import pytest

from cloud_helpers import REVIEWED_AT, REVIEWER, attestation_for, ready_export, write_json
from dataset_builder import DEFAULT_ITEMS, SNAPSHOT_ID, patient_key, uid
from synthetic import SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_SOP_UID, SENTINEL_STUDY_UID


def run(*args):
    result = subprocess.run(
        [sys.executable, "-m", "childbex_ml.cloud_artifact", *map(str, args)], capture_output=True, text=True, timeout=300
    )
    return result.returncode, result.stdout, result.stderr


def assert_clean(text, base, *, allow_image_ids=False):
    forbidden = [SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_SOP_UID, SENTINEL_STUDY_UID, "SENTINEL_DIR", str(base),
                 REVIEWER, REVIEWED_AT, "reviewerReference", "CHEST", SNAPSHOT_ID, ".dcm", "1.2.840.10008",
                 *[patient_key(n) for n in range(1, 7)]]
    if not allow_image_ids:
        forbidden += [uid("3", n) for n in range(1, 10)]
    for value in forbidden:
        assert value not in text, value


@pytest.fixture
def base(tmp_path):
    directory = tmp_path / "SENTINEL_DIR"
    directory.mkdir()
    return directory


def build_args(base, export, name="artifact"):
    return ["build", "--root", export["root"], "--preset", "ct-multi-window-v1", "--output", base / name,
            "--provenance", base / f"{name}.provenance.json", "--attestation", export["attestation"], "--shard-size", "4"]


def test_build_verify_inspect(base):
    export = ready_export(base)
    code, out, err = run(*build_args(base, export))
    assert code == 0, out + err
    summary = json.loads(out)
    assert summary["ok"] is True and summary["sampleCount"] == 9
    assert "not anonymous" in err
    assert_clean(out + err, base)

    for command in ("verify", "inspect"):
        code, out, err = run(command, "--root", base / "artifact")
        assert code == 0, out + err
        payload = json.loads(out)
        assert payload["artifactSha256"] == summary["artifactSha256"]
        assert payload["privacy"]["classification"] == "PSEUDONYMOUS_PRIVACY_MINIMIZED"
        assert_clean(out + err, base)
    assert json.loads(run("verify", "--root", base / "artifact")[1])["verifiedSamples"] == 9


def test_build_rejections(base):
    changes = {4: {"burned_in_annotation": "YES"}}
    export = ready_export(base, [(n, p, s, l, changes.get(n, k)) for n, p, s, l, k in DEFAULT_ITEMS])
    code, out, err = run(*build_args(base, export))
    payload = json.loads(out)
    assert code == 2 and payload["errorCode"] == "PIXEL_GATE_FAILED"
    assert payload["failures"] == [{"patientImageId": uid("3", 4), "code": "BURNED_IN_ANNOTATION"}]
    assert_clean(out + err, base, allow_image_ids=True)  # controlled-side image ids only

    write_json(export["attestation"], attestation_for(export["sha256"], bodyRegion="HEAD"))
    code, out, err = run(*build_args(base, export, "other"))
    assert code == 2 and json.loads(out)["errorCode"] == "ATTESTATION_SCOPE_UNSUPPORTED"
    assert "HEAD" not in out + err
    assert_clean(out + err, base)
    assert sorted(p.name for p in base.iterdir()) == ["attestation.json", "export"]


def test_usage_and_invalid_artifact_do_not_echo_paths(base):
    for args in (["build", "--root", base / "x"], ["SENTINEL"], ["verify"]):
        code, out, err = run(*args)
        assert code == 1 and out == ""
        assert_clean(out + err, base)
    code, out, err = run("verify", "--root", base / "missing")
    assert code == 2 and json.loads(out)["errorCode"] == "ARTIFACT_INCOMPLETE"
    assert_clean(out + err, base)
