"""Building the cloud artifact: equality with SnapshotDataset, determinism,
tokens and provenance, privacy, gates, atomicity."""

import hashlib
import json
import re

import numpy as np
import pytest

from childbex_ml.cloud_artifact import CloudArtifact, CloudArtifactError
from childbex_ml.cloud_artifact.build import _sample_order_key
from childbex_ml.dataset import DatasetError, SnapshotDataset
from childbex_ml.preprocessing import load_preset
from childbex_ml.privacy import AttestationError
from cloud_helpers import REVIEWED_AT, REVIEWER, all_artifact_bytes, attestation_for, build, ready_export, write_json
from dataset_builder import DEFAULT_ITEMS, SNAPSHOT_ID, patient_key, uid
from synthetic import (
    SENTINEL_NAME,
    SENTINEL_PATIENT_ID,
    SENTINEL_SERIES_UID,
    SENTINEL_SOP_UID,
    SENTINEL_STUDY_UID,
)

UUID = re.compile(rb"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


@pytest.fixture
def export(tmp_path):
    return ready_export(tmp_path)


@pytest.fixture
def built(tmp_path, export):
    return build(tmp_path, export, shard_size=4)


def provenance_of(built) -> dict:
    return json.loads(built["provenance"].read_text("utf-8"))


def test_tensors_equal_snapshot_dataset_output(tmp_path, export, built):
    dataset = SnapshotDataset.open(export["root"], load_preset("ct-multi-window-v1"))
    expected = {s.patient_image_id: s for split in ("TRAIN", "VALIDATION", "TEST") for s in dataset.iter_split(split)}
    to_image = {s["sampleToken"]: s["patientImageId"] for s in provenance_of(built)["samples"]}
    artifact = CloudArtifact.open(built["root"])
    seen = 0
    for split in ("TRAIN", "VALIDATION", "TEST"):
        for sample in artifact.iter_split(split):
            original = expected[to_image[sample.sample_token]]
            assert sample.tensor.tobytes() == original.tensor.tobytes()
            assert (sample.label, sample.label_index, sample.split) == (original.label, original.label_index, original.split)
            seen += 1
    assert seen == 9


def test_shards_are_standard_little_endian_float32_c_order(built):
    for path in sorted((built["root"] / "tensors").iterdir()):
        array = np.load(path, allow_pickle=False)
        assert array.dtype == np.dtype("<f4") and array.dtype.str == "<f4"
        assert array.flags["C_CONTIGUOUS"] and not array.flags["F_CONTIGUOUS"]
        assert array.ndim == 4 and array.shape[1:] == (224, 224, 3)
        with open(path, "rb") as stream:
            assert stream.read(6) == b"\x93NUMPY" and stream.read(2) == b"\x01\x00"
    assert [p.name for p in sorted((built["root"] / "tensors").iterdir())] == [
        "TEST-00000.npy", "TRAIN-00000.npy", "TRAIN-00001.npy", "VALIDATION-00000.npy",
    ]


def test_two_builds_are_identical(tmp_path, export, built):
    second = build(tmp_path, export, "artifact-2", shard_size=4)
    assert second["summary"]["artifactSha256"] == built["summary"]["artifactSha256"]
    for name in ["manifest.json", *[f"tensors/{p.name}" for p in (built["root"] / "tensors").iterdir()]]:
        assert (built["root"] / name).read_bytes() == (second["root"] / name).read_bytes()
    first, other = provenance_of(built), provenance_of(second)
    first.pop("createdAt"), other.pop("createdAt")
    assert first == other


def test_manifest_hash_is_the_file_hash(built):
    data = (built["root"] / "manifest.json").read_bytes()
    assert hashlib.sha256(data).hexdigest() == built["summary"]["artifactSha256"]


def test_tokens_and_provenance_trace_every_sample(export, built):
    manifest = json.loads((built["root"] / "manifest.json").read_text("utf-8"))
    provenance = provenance_of(built)
    assert [p["patientToken"] for p in manifest["patients"]] == [f"p{n:05d}" for n in range(1, 7)]
    assert [s["sampleToken"] for s in manifest["samples"]] == [f"s{n:06d}" for n in range(1, 10)]
    to_key = {p["patientToken"]: p["patientGroupKey"] for p in provenance["patients"]}
    to_image = {s["sampleToken"]: s["patientImageId"] for s in provenance["samples"]}
    items = {item["patientImageId"]: item for item in export["manifest"]["items"]}
    assert set(to_image.values()) == set(items)
    for sample in manifest["samples"]:
        item = items[to_image[sample["sampleToken"]]]
        assert to_key[sample["patientToken"]] == item["patientGroupKey"]
        assert (sample["split"], sample["label"]) == (item["split"], item["label"])
    assert provenance["snapshotId"] == SNAPSHOT_ID
    assert provenance["manifestSha256"] == export["sha256"] == manifest["source"]["manifestSha256"]
    assert provenance["artifactSha256"] == built["summary"]["artifactSha256"]
    assert provenance["attestation"]["reviewerReference"] == REVIEWER
    assert len(provenance["attestationSha256"]) == 64


def test_slice_order_is_broken_by_the_hash_order(export, built):
    """Within a patient, samples follow SHA-256(manifestSha256 + patientImageId),
    not the series order."""
    manifest = json.loads((built["root"] / "manifest.json").read_text("utf-8"))
    to_image = {s["sampleToken"]: s["patientImageId"] for s in provenance_of(built)["samples"]}
    p1_token = next(p["patientToken"] for p in provenance_of(built)["patients"] if p["patientGroupKey"] == patient_key(1))
    images = [to_image[s["sampleToken"]] for s in manifest["samples"] if s["patientToken"] == p1_token]
    assert images == sorted(images, key=lambda i: _sample_order_key(export["sha256"], i))
    keys = {key for sample in manifest["samples"] for key in sample}
    assert keys == {"sampleToken", "patientToken", "split", "label", "labelIndex", "shard", "index", "tensorSha256"}


def test_artifact_contains_no_identifiers_dicom_or_attestation(tmp_path, export, built):
    data = all_artifact_bytes(built["root"])
    assert UUID.search(data) is None  # no ChildBEx UUIDs, no snapshot id
    for forbidden in (
        SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_STUDY_UID, SENTINEL_SERIES_UID, SENTINEL_SOP_UID, "SENTINEL",
        "DICM", "1.2.840.10008", "1.2.826.0.1.3680043", "PatientName", "SOPInstanceUID", "ImageType",
        "seriesId", "studyId", "patientId", "patientImageId", "patientGroupKey", "seriesOrderIndex", "snapshotId",
        SNAPSHOT_ID, REVIEWER, REVIEWED_AT, "reviewerReference", "reviewedAt", "attestationSha256", "bodyRegion",
        ".dcm", "export", "provenance", str(tmp_path), tmp_path.name,
    ):
        assert forbidden.encode() not in data, forbidden
    names = sorted(str(p.relative_to(built["root"])).replace("\\", "/") for p in built["root"].rglob("*"))
    assert names == [
        "CLOUD_ARTIFACT_COMPLETE.json", "README-SENSITIVE.txt", "manifest.json", "tensors",
        "tensors/TEST-00000.npy", "tensors/TRAIN-00000.npy", "tensors/TRAIN-00001.npy", "tensors/VALIDATION-00000.npy",
    ]
    manifest = json.loads((built["root"] / "manifest.json").read_text("utf-8"))
    assert manifest["privacy"] == {
        "containsDicom": False, "dicomMetadata": "NONE", "pixelContent": "PRESENT",
        "classification": "PSEUDONYMOUS_PRIVACY_MINIMIZED", "pixelGate": "PIXEL_GATE_V1", "attestationVerified": True,
    }
    assert set(manifest["source"]) == {"manifestSha256", "preflightIdentity"}


def test_pixel_gate_failures_are_all_reported_and_nothing_is_written(tmp_path):
    changes = {3: {"image_type": ("ORIGINAL", "PRIMARY", "LOCALIZER")}, 6: {"burned_in_annotation": "YES"},
               9: {"image_type": ("DERIVED", "SECONDARY", "AXIAL")}}
    export = ready_export(tmp_path, [(n, p, s, l, changes.get(n, k)) for n, p, s, l, k in DEFAULT_ITEMS])
    with pytest.raises(CloudArtifactError) as error:
        build(tmp_path, export)
    assert error.value.code == "PIXEL_GATE_FAILED"
    assert error.value.failures == [
        {"patientImageId": uid("3", 3), "code": "UNSAFE_IMAGE_TYPE"},
        {"patientImageId": uid("3", 6), "code": "BURNED_IN_ANNOTATION"},
        {"patientImageId": uid("3", 9), "code": "UNSAFE_IMAGE_TYPE"},
    ]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["attestation.json", "export"]


def test_preflight_and_attestation_are_required(tmp_path):
    from dataset_builder import build_export

    export = build_export(tmp_path / "export")
    export["attestation"] = write_json(tmp_path / "attestation.json", attestation_for(export["sha256"]))
    with pytest.raises(DatasetError) as error:
        build(tmp_path, export)
    assert error.value.code == "PREFLIGHT_REQUIRED"

    ready = ready_export(tmp_path / "r")
    for bad, code in [
        (tmp_path / "missing.json", "ATTESTATION_MISSING"),
        (write_json(tmp_path / "other.json", attestation_for("c" * 64)), "ATTESTATION_MANIFEST_MISMATCH"),
        (write_json(tmp_path / "head.json", attestation_for(ready["sha256"], headCtIncluded=True)), "ATTESTATION_SCOPE_UNSUPPORTED"),
    ]:
        with pytest.raises(AttestationError) as error:
            build(tmp_path / "r", ready, attestation=bad)
        assert error.value.code == code
    assert sorted(p.name for p in (tmp_path / "r").iterdir()) == ["attestation.json", "export"]


def test_unsafe_targets_are_refused(tmp_path, export):
    from childbex_ml.cloud_artifact.build import build_cloud_artifact

    preset = load_preset("ct-multi-window-v1")
    cases = [
        (tmp_path / "a", tmp_path / "a" / "provenance.json", "PROVENANCE_INSIDE_ARTIFACT"),
        (export["root"] / "artifact", tmp_path / "p.json", "OUTPUT_INSIDE_SOURCE"),
        (tmp_path / "missing" / "a", tmp_path / "p.json", "OUTPUT_PARENT_MISSING"),
        (tmp_path / "a", tmp_path / "missing" / "p.json", "PROVENANCE_PARENT_MISSING"),
        (tmp_path / "export", tmp_path / "p.json", "OUTPUT_EXISTS"),
    ]
    for output, provenance, code in cases:
        with pytest.raises(CloudArtifactError) as error:
            build_cloud_artifact(export["root"], preset, output, provenance, export["attestation"])
        assert error.value.code == code
    write_json(tmp_path / "p.json", {})
    with pytest.raises(CloudArtifactError) as error:
        build_cloud_artifact(export["root"], preset, tmp_path / "a", tmp_path / "p.json", export["attestation"])
    assert error.value.code == "PROVENANCE_EXISTS"
    assert not (tmp_path / "a").exists()


@pytest.mark.parametrize("hook", ["beforeComplete", "beforeProvenance"])
def test_failure_late_in_the_build_leaves_nothing(tmp_path, export, hook):
    def boom(*_):
        raise RuntimeError("simulated failure")

    with pytest.raises(RuntimeError):
        build(tmp_path, export, hooks={hook: boom})
    assert sorted(p.name for p in tmp_path.iterdir()) == ["attestation.json", "export"]


def test_shard_is_reverified_after_writing(tmp_path, export):
    def corrupt(path):
        data = bytearray(path.read_bytes())
        data[-1] ^= 0x01
        path.write_bytes(bytes(data))

    with pytest.raises(CloudArtifactError) as error:
        build(tmp_path, export, hooks={"afterShard": corrupt})
    assert error.value.code == "TENSOR_HASH_MISMATCH"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["attestation.json", "export"]


def test_invalid_shard_size(tmp_path, export):
    with pytest.raises(CloudArtifactError) as error:
        build(tmp_path, export, shard_size=0)
    assert error.value.code == "INVALID_SHARD_SIZE"


# --- patient tokens: salted per source manifest ----------------------------------------


def _token_map(built) -> dict:
    return {p["patientToken"]: p["patientGroupKey"] for p in provenance_of(built)["patients"]}


def test_patient_tokens_follow_the_salted_ordering(export, built):
    from childbex_ml.cloud_artifact.build import _patient_order_key

    provenance = provenance_of(built)
    manifest = json.loads((built["root"] / "manifest.json").read_text("utf-8"))
    split_of = {p["patientToken"]: p["split"] for p in manifest["patients"]}
    for split in ("TRAIN", "VALIDATION", "TEST"):
        keys = [p["patientGroupKey"] for p in provenance["patients"] if split_of[p["patientToken"]] == split]
        assert keys == sorted(keys, key=lambda k: _patient_order_key(export["sha256"], k))
    assert [p["patientToken"] for p in provenance["patients"]] == [f"p{n:05d}" for n in range(1, 7)]
    # The ordering key itself is never written to the artifact.
    data = all_artifact_bytes(built["root"])
    for key in _token_map(built).values():
        assert _patient_order_key(export["sha256"], key).encode() not in data


def test_same_manifest_gives_identical_patient_tokens_and_artifact(tmp_path, export, built):
    again = build(tmp_path, export, "again", shard_size=4)
    assert _token_map(again) == _token_map(built)
    first = json.loads((built["root"] / "manifest.json").read_text("utf-8"))
    second = json.loads((again["root"] / "manifest.json").read_text("utf-8"))
    assert first["patients"] == second["patients"]
    assert again["summary"]["artifactSha256"] == built["summary"]["artifactSha256"]


def test_patient_tokens_change_with_the_source_manifest(tmp_path, built):
    # Same six patients, same splits; one file differs, so manifestSha256 differs.
    items = [(n, p, s, l, {"intercept": -1000} if n == 7 else k) for n, p, s, l, k in DEFAULT_ITEMS]
    other_export = ready_export(tmp_path / "other", items)
    other = build(tmp_path / "other", other_export, shard_size=4)
    assert other_export["manifest"]["snapshot"] == json.loads((tmp_path / "export" / "manifest.json").read_text())["snapshot"]
    original_map, other_map = _token_map(built), _token_map(other)
    assert set(original_map.values()) == set(other_map.values())  # same patients
    assert original_map != other_map  # different token assignment
    # Splits are unchanged: tokens only re-ordered within a split.
    split_by_key = lambda b: {  # noqa: E731
        _token_map(b)[p["patientToken"]]: p["split"]
        for p in json.loads((b["root"] / "manifest.json").read_text("utf-8"))["patients"]
    }
    assert split_by_key(built) == split_by_key(other)


def test_salted_patient_order_is_not_stable_across_manifests():
    from childbex_ml.cloud_artifact.build import _patient_order_key

    keys = [patient_key(n) for n in range(1, 9)]
    orders = {
        tuple(sorted(keys, key=lambda k: _patient_order_key(hashlib.sha256(str(i).encode()).hexdigest(), k)))
        for i in range(20)
    }
    assert len(orders) > 10  # practically a different permutation per manifest


def test_patient_group_keys_never_appear_but_provenance_maps_all(export, built):
    data = all_artifact_bytes(built["root"])
    for n in range(1, 7):
        assert patient_key(n).encode() not in data
    mapping = _token_map(built)
    assert sorted(mapping.values()) == sorted(patient_key(n) for n in range(1, 7))
    manifest = json.loads((built["root"] / "manifest.json").read_text("utf-8"))
    assert set(mapping) == {p["patientToken"] for p in manifest["patients"]}
    items = {i["patientImageId"]: i for i in export["manifest"]["items"]}
    to_image = {s["sampleToken"]: s["patientImageId"] for s in provenance_of(built)["samples"]}
    for sample in manifest["samples"]:
        assert mapping[sample["patientToken"]] == items[to_image[sample["sampleToken"]]]["patientGroupKey"]
