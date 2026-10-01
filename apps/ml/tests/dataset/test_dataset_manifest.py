"""Manifest schema v1: validation, split integrity, counts, canonical hash."""

import copy
import json
import random
from pathlib import Path

import pytest

from childbex_ml.dataset import DatasetError, manifest_sha256, validate_manifest
from childbex_ml.dataset.manifest import parse_manifest_bytes
from dataset_builder import build_manifest, patient_key, uid

GOLDEN = Path(__file__).resolve().parent.parent / "fixtures" / "manifest-golden.json"
# Shared with apps/be services/dataset-snapshot/canonical-json.spec.ts.
GOLDEN_MANIFEST_SHA256 = "c05a73e04eba3b3343f22a9f4246b5af405b959d0818538133db063b720a943a"


def code_of(manifest) -> str:
    with pytest.raises(DatasetError) as error:
        validate_manifest(manifest)
    return error.value.code


@pytest.fixture
def manifest():
    return build_manifest()[0]


# --- golden vector / canonical hash ---------------------------------------------------


def test_golden_vector_matches_node():
    raw = json.loads(GOLDEN.read_text("utf-8"))
    assert manifest_sha256(raw) == GOLDEN_MANIFEST_SHA256
    validated = validate_manifest(raw)
    assert validated.sha256 == GOLDEN_MANIFEST_SHA256
    assert [item.patient_image_id[-1] for item in validated.items] == ["1", "2", "3", "4", "5"]


def test_reordered_and_reformatted_input_gives_the_same_hash(manifest):
    reference = manifest_sha256(manifest)
    for seed in range(5):
        shuffled = copy.deepcopy(manifest)
        random.Random(seed).shuffle(shuffled["items"])
        random.Random(seed).shuffle(shuffled["patients"])
        reformatted = json.loads(json.dumps(shuffled, indent=4, sort_keys=False))
        assert manifest_sha256(reformatted) == reference
        assert validate_manifest(reformatted).sha256 == reference


def test_semantic_changes_change_the_hash(manifest):
    reference = manifest_sha256(manifest)
    changed = copy.deepcopy(manifest)
    changed["items"][0]["fileSha256"] = "f" * 64
    assert manifest_sha256(changed) != reference
    changed = copy.deepcopy(manifest)
    changed["snapshot"]["splitSeed"] = "other"
    assert manifest_sha256(changed) != reference


# --- valid manifest -------------------------------------------------------------------------


def test_valid_manifest_is_accepted_in_canonical_order(manifest):
    validated = validate_manifest(manifest)
    assert len(validated.items) == 9 and len(validated.patients) == 6
    splits = [item.split for item in validated.items]
    assert splits == ["TRAIN"] * 7 + ["VALIDATION", "TEST"]
    keys = [(i.split, i.patient_group_key, i.series_id, i.series_order_index, i.patient_image_id) for i in validated.items]
    assert keys == sorted(keys, key=lambda k: (["TRAIN", "VALIDATION", "TEST"].index(k[0]),) + k[1:])


def test_mixed_label_patient_stays_in_one_split(manifest):
    validated = validate_manifest(manifest)
    p1 = [item for item in validated.items if item.patient_group_key == patient_key(1)]
    assert {item.label for item in p1} == {"NORMAL", "ABNORMAL"}
    assert {item.split for item in p1} == {"TRAIN"}


# --- rejections ------------------------------------------------------------------------------


def mutate(manifest, fn):
    changed = copy.deepcopy(manifest)
    fn(changed)
    return changed


@pytest.mark.parametrize(
    ("fn", "code"),
    [
        (lambda m: m["items"].append(copy.deepcopy(m["items"][0])), "DUPLICATE_ITEM"),
        (lambda m: m["items"][1].__setitem__("seriesOrderIndex", m["items"][0]["seriesOrderIndex"]), "DUPLICATE_ITEM"),
        (lambda m: m["items"][0].__setitem__("split", "HOLDOUT"), "INVALID_MANIFEST"),
        (lambda m: m["patients"][0].__setitem__("split", "TRAINING"), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("label", "UNCERTAIN"), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("fileSha256", "A" * 64), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("fileSha256", "abc"), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("fileSize", 0), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("fileSize", True), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("patientImageId", "../../etc/passwd"), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("patientImageId", "3333333A-3333-4333-8333-000000000001"), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("source", "/uploads/x.dcm"), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].pop("seriesId"), "INVALID_MANIFEST"),
        (lambda m: m["snapshot"].__setitem__("status", "FINALIZED"), "INVALID_MANIFEST"),
        (lambda m: m.__setitem__("manifestSchemaVersion", 2), "INVALID_MANIFEST"),
        (lambda m: m["snapshot"].__setitem__("datasetSchemaVersion", 2), "INVALID_MANIFEST"),
        (lambda m: m["items"][0].__setitem__("reviewStateAtSnapshot", "ABNORMAL"), "INVALID_MANIFEST"),
        (lambda m: m["snapshot"].__setitem__("finalizedAt", None), "SNAPSHOT_NOT_FINALIZED"),
        # Patient leakage / split integrity.
        (lambda m: m["items"][-1].__setitem__("split", "TRAIN"), "SNAPSHOT_SPLIT_INTEGRITY_ERROR"),
        (lambda m: m["patients"].append({**m["patients"][0], "split": "TEST"}), "SNAPSHOT_SPLIT_INTEGRITY_ERROR"),
        (lambda m: m["items"][0].__setitem__("patientGroupKey", patient_key(99)), "SNAPSHOT_SPLIT_INTEGRITY_ERROR"),
        (lambda m: m["items"][0].__setitem__("patientId", patient_key(2)), "SNAPSHOT_SPLIT_INTEGRITY_ERROR"),
        (lambda m: m["items"][0].__setitem__("studyId", uid("4", 2)), "SNAPSHOT_SPLIT_INTEGRITY_ERROR"),
        # Counts.
        (lambda m: m["snapshot"].__setitem__("totalImages", 10), "SNAPSHOT_COUNT_MISMATCH"),
        (lambda m: m["snapshot"].__setitem__("totalPatients", 7), "SNAPSHOT_COUNT_MISMATCH"),
        (lambda m: m["snapshot"].__setitem__("normalImages", 4), "SNAPSHOT_COUNT_MISMATCH"),
        (lambda m: m["patients"][0].__setitem__("imageCount", 4), "SNAPSHOT_COUNT_MISMATCH"),
        (lambda m: m["patients"][0].__setitem__("stratum", "NORMAL_ONLY"), "SNAPSHOT_COUNT_MISMATCH"),
        (lambda m: m["items"].pop(), "SNAPSHOT_COUNT_MISMATCH"),
    ],
)
def test_invalid_manifests_are_rejected(manifest, fn, code):
    assert code_of(mutate(manifest, fn)) == code


def test_patient_leakage_both_directions(manifest):
    # One patient's item moved into VALIDATION while its patient row is TRAIN.
    leaked = mutate(manifest, lambda m: m["items"][0].__setitem__("split", "VALIDATION"))
    with pytest.raises(DatasetError) as error:
        validate_manifest(leaked)
    assert error.value.code == "SNAPSHOT_SPLIT_INTEGRITY_ERROR"
    assert "patient" in str(error.value)


def test_duplicate_json_keys_are_rejected():
    with pytest.raises(DatasetError) as error:
        parse_manifest_bytes(b'{"manifestSchemaVersion": 1, "manifestSchemaVersion": 1}')
    assert error.value.code == "INVALID_MANIFEST"


def test_manifest_has_no_path_filename_or_uid_fields(manifest):
    text = json.dumps(manifest)
    for forbidden in ("source", "path", "fileName", "filename", "InstanceUid", "Uid", "PatientName", ".dcm", "/uploads"):
        assert forbidden not in text
    assert set(manifest["items"][0]) == {
        "patientImageId", "patientGroupKey", "patientId", "studyId", "seriesId", "split", "label",
        "reviewStateAtSnapshot", "reviewStateSourceAtSnapshot", "seriesOrderIndex", "fileSha256", "fileSize",
    }
