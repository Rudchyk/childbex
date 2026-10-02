"""TRAINING_RUNTIME_V1 check and the pretrained-weight resolver (offline)."""

import hashlib

import pytest

import childbex_ml.training.weights as weights_module
from childbex_ml.training import TrainingError, check_runtime
from childbex_ml.training.weights import EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1 as SPEC
from childbex_ml.training.weights import WeightSpec, resolve_weights
from training_helpers import fake_weights_fetch

EXACT = {"python": "3.12.10", "tensorflow": "2.20.0", "keras": "3.11.3", "numpy": "2.1.3"}


def code_of(fn):
    with pytest.raises(TrainingError) as error:
        fn()
    return error.value.code, error.value.detail


def test_exact_runtime_accepted():
    assert check_runtime(EXACT, (3, 12)) == EXACT


@pytest.mark.parametrize(
    ("change", "python", "detail"),
    [
        ({"tensorflow": "2.20.1"}, (3, 12), "tensorflow"),
        ({"tensorflow": "2.21.0"}, (3, 12), "tensorflow"),
        ({"tensorflow": None}, (3, 12), "tensorflow"),  # not installed
        ({"keras": "3.12.4"}, (3, 12), "keras"),
        ({"keras": "3.11.2"}, (3, 12), "keras"),
        ({"numpy": "2.0.2"}, (3, 12), "numpy"),  # Colab 2026.07 default
        ({}, (3, 11), "python"),
        ({}, (3, 13), "python"),
    ],
)
def test_any_other_runtime_rejected(change, python, detail):
    assert code_of(lambda: check_runtime({**EXACT, **change}, python)) == ("UNSUPPORTED_RUNTIME", detail)


def test_this_environment_matches_the_profile_when_tensorflow_is_installed():
    pytest.importorskip("tensorflow")
    versions = check_runtime()
    assert (versions["tensorflow"], versions["keras"], versions["numpy"]) == ("2.20.0", "3.11.3", "2.1.3")


def test_weight_spec_is_the_official_keras_3_11_3_b0_notop():
    assert SPEC.spec == "EFFICIENTNETV2B0_IMAGENET_KERAS_3_11_3_V1"
    assert SPEC.file_name == "efficientnetv2-b0_notop.h5"
    assert SPEC.origin == "https://storage.googleapis.com/tensorflow/keras-applications/efficientnet_v2/efficientnetv2-b0_notop.h5"
    assert (SPEC.official_checksum, SPEC.checksum_algorithm) == ("893217f2bb855e2983157299931e43ff", "md5")


def test_spec_matches_installed_keras_source():
    pytest.importorskip("keras")
    from keras.src.applications import efficientnet_v2

    assert efficientnet_v2.BASE_WEIGHTS_PATH + SPEC.file_name == SPEC.origin
    assert efficientnet_v2.WEIGHTS_HASHES["b0"][1] == SPEC.official_checksum


def test_resolver_uses_public_fetch_contract_and_records_sha256(tmp_path, monkeypatch):
    fetch = fake_weights_fetch(tmp_path)
    local = WeightSpec(SPEC.spec, SPEC.source, SPEC.file_name, SPEC.origin, fetch.md5, "md5")
    monkeypatch.setitem(weights_module.SPECS, SPEC.spec, local)
    path, provenance = resolve_weights(SPEC.spec, fetch)
    assert fetch.calls == [
        {"fname": SPEC.file_name, "origin": SPEC.origin, "file_hash": fetch.md5, "hash_algorithm": "md5", "cache_subdir": "models"}
    ]
    assert path.name == SPEC.file_name
    assert provenance == {
        "weightSpec": SPEC.spec,
        "source": SPEC.source,
        "origin": SPEC.origin,
        "fileName": SPEC.file_name,
        "officialChecksum": fetch.md5,
        "officialChecksumAlgorithm": "md5",
        "sha256": fetch.sha256,
    }
    assert str(tmp_path) not in repr(provenance)  # no local path in provenance


def test_resolver_rejects_wrong_checksum_and_failures(tmp_path):
    fetch = fake_weights_fetch(tmp_path)  # its MD5 is not the official one
    assert code_of(lambda: resolve_weights(SPEC.spec, fetch)) == ("WEIGHTS_UNAVAILABLE", "official checksum mismatch")

    def failing(**kwargs):
        raise OSError("offline")

    assert code_of(lambda: resolve_weights(SPEC.spec, failing))[0] == "WEIGHTS_UNAVAILABLE"
    assert code_of(lambda: resolve_weights("IMAGENET", fetch))[0] == "WEIGHTS_UNAVAILABLE"


def test_network_is_blocked_in_training_tests():
    import socket
    import urllib.request

    with pytest.raises(RuntimeError):
        socket.create_connection(("storage.googleapis.com", 443), timeout=1)
    with pytest.raises(Exception):
        urllib.request.urlopen(SPEC.origin, timeout=1)
    assert hashlib.md5(b"").hexdigest()  # hashing still works offline
