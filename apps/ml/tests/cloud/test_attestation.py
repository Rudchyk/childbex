"""Structured pixel-review attestation (schema v1)."""

import json

import pytest

from childbex_ml.canonical import hash_canonical
from childbex_ml.privacy import AttestationError, load_attestation, validate_attestation
from cloud_helpers import REVIEWER, attestation_for, write_json

SHA = "a" * 64


def code_of(doc, manifest_sha=SHA):
    with pytest.raises(AttestationError) as error:
        validate_attestation(doc, manifest_sha)
    return error.value.code, error.value.detail


def test_valid_attestation_and_hash(tmp_path):
    doc = attestation_for(SHA)
    assert validate_attestation(doc, SHA) == doc
    loaded, digest = load_attestation(write_json(tmp_path / "a.json", doc), SHA)
    assert loaded == doc and digest == hash_canonical(doc)
    reordered = write_json(tmp_path / "b.json", dict(reversed(list(doc.items()))))
    assert load_attestation(reordered, SHA)[1] == digest


def test_manifest_hash_mismatch():
    assert code_of(attestation_for("b" * 64)) == ("ATTESTATION_MANIFEST_MISMATCH", None)


def test_missing_and_unreadable(tmp_path):
    with pytest.raises(AttestationError) as error:
        load_attestation(tmp_path / "missing.json", SHA)
    assert error.value.code == "ATTESTATION_MISSING"
    (tmp_path / "bad.json").write_text("{not json", "utf-8")
    with pytest.raises(AttestationError) as error:
        load_attestation(tmp_path / "bad.json", SHA)
    assert error.value.code == "ATTESTATION_INVALID"
    (tmp_path / "dup.json").write_text('{"scope": "A", "scope": "B"}', "utf-8")
    with pytest.raises(AttestationError) as error:
        load_attestation(tmp_path / "dup.json", SHA)
    assert error.value.code == "ATTESTATION_INVALID"


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"scope": "SAMPLED_IMAGES"}, ("ATTESTATION_SCOPE_UNSUPPORTED", "scope")),
        ({"pixelReview": "NOT_REVIEWED"}, ("ATTESTATION_SCOPE_UNSUPPORTED", "pixelReview")),
        ({"bodyRegion": "HEAD"}, ("ATTESTATION_SCOPE_UNSUPPORTED", "bodyRegion")),
        ({"bodyRegion": "chest"}, ("ATTESTATION_SCOPE_UNSUPPORTED", "bodyRegion")),
        ({"headCtIncluded": True}, ("ATTESTATION_SCOPE_UNSUPPORTED", "headCtIncluded")),
        ({"headCtIncluded": 0}, ("ATTESTATION_INVALID", "headCtIncluded")),
        ({"attestationSchemaVersion": 2}, ("ATTESTATION_INVALID", "attestationSchemaVersion")),
        ({"attestationSchemaVersion": True}, ("ATTESTATION_INVALID", "attestationSchemaVersion")),
        ({"reviewedAt": "yesterday"}, ("ATTESTATION_INVALID", "reviewedAt")),
        ({"reviewedAt": "2026-13-45T00:00:00Z"}, ("ATTESTATION_INVALID", "reviewedAt")),
        ({"reviewerReference": ""}, ("ATTESTATION_INVALID", "reviewerReference")),
        ({"reviewerReference": "Jane Doe"}, ("ATTESTATION_INVALID", "reviewerReference")),
        ({"reviewerReference": "jane.doe@hospital.example"}, ("ATTESTATION_INVALID", "reviewerReference")),
        ({"reviewerReference": "C:\\reviews\\jane.txt"}, ("ATTESTATION_INVALID", "reviewerReference")),
        ({"reviewerReference": 42}, ("ATTESTATION_INVALID", "reviewerReference")),
        ({"manifestSha256": "A" * 64}, ("ATTESTATION_INVALID", "manifestSha256")),
        ({"reviewerName": "Jane"}, ("ATTESTATION_INVALID", "unknown field")),
        ({"attestationPath": "/tmp/x"}, ("ATTESTATION_INVALID", "unknown field")),
    ],
)
def test_invalid_attestations(overrides, expected):
    assert code_of(attestation_for(SHA, **overrides)) == expected


def test_missing_field():
    doc = attestation_for(SHA)
    del doc["bodyRegion"]
    assert code_of(doc) == ("ATTESTATION_INVALID", "missing field")


def test_errors_never_echo_values():
    with pytest.raises(AttestationError) as error:
        validate_attestation(attestation_for(SHA, reviewerReference="Jane Doe"), SHA)
    assert "Jane" not in str(error.value)
    with pytest.raises(AttestationError) as error:
        validate_attestation(attestation_for("b" * 64), SHA)
    assert REVIEWER not in str(error.value) and "b" * 64 not in str(error.value)
    assert json.dumps(error.value.detail) == "null"
