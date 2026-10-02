"""PR11 must not change the shared canonical JSON: existing PR9 / PR10 /
PR10.5 hashes stay byte-identical."""

import json
from pathlib import Path

import pytest

from childbex_ml.canonical import CanonicalJsonError, canonical_json, hash_canonical
from childbex_ml.dataset import manifest_sha256
from childbex_ml.preprocessing import config_hash, load_preset

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def test_pr9_preset_hashes_unchanged():
    assert config_hash(load_preset("ct-multi-window-v1")) == "1a3609705448b3a00789101fdbbb9ed958e5adfc60b7a5ac3f0cb5ccedf84275"
    assert config_hash(load_preset("ct-single-window-v1")) == "5f3af5cf2f53efccb7f68621b01ed9bc14d88f7e1a573c1c2cb2e629624e10d2"


def test_pr10_golden_manifest_hash_unchanged():
    raw = json.loads((FIXTURES / "manifest-golden.json").read_text("utf-8"))
    assert manifest_sha256(raw) == "c05a73e04eba3b3343f22a9f4246b5af405b959d0818538133db063b720a943a"


@pytest.mark.parametrize(
    ("value", "text"),
    [
        ({"b": 1.0, "a": 0.15, "c": [40.0, -0.0, "x"]}, '{"a":0.15,"b":1,"c":[40,0,"x"]}'),
        ({"lr": "0.00001"}, '{"lr":"0.00001"}'),
        (0.001, "0.001"),
        (0.05, "0.05"),
    ],
)
def test_canonical_json_semantics_unchanged(value, text):
    assert canonical_json(value) == text


@pytest.mark.parametrize("value", [1e-5, 1e-7, float("nan"), float("inf")])
def test_exponent_and_non_finite_numbers_still_rejected(value):
    with pytest.raises(CanonicalJsonError):
        canonical_json(value)


def test_known_hash_vector():
    assert hash_canonical({"a": 1}) == "015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
