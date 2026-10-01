"""Integrity verification before decoding."""

import hashlib

import pytest

from childbex_ml.preprocessing import PreprocessingError, load_verified_bytes, preprocess_dicom_bytes
from synthetic import ct_bytes


@pytest.fixture
def stored_file(tmp_path):
    data = ct_bytes()
    path = tmp_path / "slice.dcm"
    path.write_bytes(data)
    return path, data, hashlib.sha256(data).hexdigest()


def test_verified_bytes_are_returned(stored_file, multi):
    path, data, digest = stored_file
    loaded = load_verified_bytes(path, digest, len(data))
    assert loaded == data
    assert preprocess_dicom_bytes(loaded, multi).shape == (224, 224, 3)


def test_size_mismatch(stored_file):
    path, data, digest = stored_file
    with pytest.raises(PreprocessingError) as error:
        load_verified_bytes(path, digest, len(data) + 1)
    assert error.value.code == "FILE_INTEGRITY_MISMATCH"


def test_same_size_other_bytes_is_rejected_before_decoding(stored_file):
    path, data, digest = stored_file
    tampered = bytearray(data)
    tampered[-1] ^= 0xFF  # still a decodable DICOM file
    path.write_bytes(bytes(tampered))
    with pytest.raises(PreprocessingError) as error:
        load_verified_bytes(path, digest, len(data))
    assert error.value.code == "FILE_INTEGRITY_MISMATCH"


def test_missing_file(tmp_path):
    with pytest.raises(PreprocessingError) as error:
        load_verified_bytes(tmp_path / "missing.dcm", "0" * 64, 1)
    assert error.value.code == "FILE_NOT_READABLE"
    assert "missing" not in str(error.value)


@pytest.mark.parametrize(("digest", "size"), [("ABC", 1), ("F" * 64, 1), ("0" * 64, -1), ("0" * 64, True)])
def test_invalid_expectations(stored_file, digest, size):
    with pytest.raises(ValueError):
        load_verified_bytes(stored_file[0], digest, size)
