"""End-to-end: transfer syntaxes, determinism, MONOCHROME1, padding, PHI."""

import dataclasses
import hashlib

import numpy as np
import pytest

from childbex_ml.preprocessing import PreprocessingError, preprocess_dicom_bytes
from conftest import with_size
from synthetic import (
    SENTINEL_NAME,
    SENTINEL_PATIENT_ID,
    SENTINEL_SERIES_UID,
    SENTINEL_SOP_UID,
    SENTINEL_STUDY_UID,
    DeflatedExplicitVRLittleEndian,
    ExplicitVRBigEndian,
    ExplicitVRLittleEndian,
    ImplicitVRLittleEndian,
    RLELossless,
    ct_bytes,
    ct_dataset,
    to_bytes,
)

SENTINELS = [SENTINEL_NAME, SENTINEL_PATIENT_ID, SENTINEL_STUDY_UID, SENTINEL_SERIES_UID, SENTINEL_SOP_UID]


def phantom(rows=64, columns=80) -> np.ndarray:
    """A synthetic slice: air, a soft-tissue disc, a bone ring, a lung patch."""
    y, x = np.mgrid[0:rows, 0:columns]
    r = np.hypot((y - rows / 2) / (rows / 2), (x - columns / 2) / (columns / 2))
    hu = np.full((rows, columns), -1000, dtype=np.int32)
    hu[r < 0.9] = 40
    hu[(r > 0.75) & (r < 0.9)] = 900
    hu[(r < 0.3) & (x < columns / 2)] = -800
    hu[5, 7] = 3071  # asymmetric marker
    return (hu + 1024).astype(np.int16)


# --- transfer syntaxes -------------------------------------------------------

SUPPORTED = [
    ("explicit", {"transfer_syntax": ExplicitVRLittleEndian}),
    ("implicit", {"transfer_syntax": ImplicitVRLittleEndian}),
    ("headerless implicit", {"transfer_syntax": ImplicitVRLittleEndian, "headerless": True}),
    ("headerless explicit", {"transfer_syntax": ExplicitVRLittleEndian, "headerless": True}),
    ("rle", {"transfer_syntax": RLELossless}),
]


@pytest.mark.parametrize(("name", "options"), SUPPORTED)
def test_supported_transfer_syntaxes_decode_to_identical_tensors(multi, name, options):
    reference = preprocess_dicom_bytes(ct_bytes(phantom()), multi).tensor
    result = preprocess_dicom_bytes(ct_bytes(phantom(), **options), multi)
    assert np.array_equal(result.tensor, reference)
    assert (result.hu_min, result.hu_max) == (-1000.0, 3071.0)


def test_rle_is_actually_compressed_and_decoded(multi):
    data = ct_bytes(phantom(), transfer_syntax=RLELossless)
    assert len(data) < phantom().nbytes  # encapsulated RLE, not native
    assert preprocess_dicom_bytes(data, multi).hu_max == 3071.0


REJECTED = [
    ExplicitVRBigEndian,
    DeflatedExplicitVRLittleEndian,
    "1.2.840.10008.1.2.4.50",  # JPEG baseline (lossy)
    "1.2.840.10008.1.2.4.51",  # JPEG extended (lossy)
    "1.2.840.10008.1.2.4.57",  # JPEG lossless
    "1.2.840.10008.1.2.4.70",  # JPEG lossless SV1
    "1.2.840.10008.1.2.4.80",  # JPEG-LS lossless
    "1.2.840.10008.1.2.4.81",  # JPEG-LS near-lossless
    "1.2.840.10008.1.2.4.90",  # JPEG 2000 lossless
    "1.2.840.10008.1.2.4.91",  # JPEG 2000
]


@pytest.mark.parametrize("transfer_syntax", REJECTED)
def test_unsupported_transfer_syntaxes_are_rejected(multi, transfer_syntax):
    from pydicom.encaps import encapsulate
    from pydicom.uid import UID

    ds = ct_dataset(phantom(8, 8), transfer_syntax=UID(transfer_syntax))
    if UID(transfer_syntax).is_compressed:
        ds.PixelData = encapsulate([b"\xff\xd8" + b"\x00" * 32 + b"\xff\xd9"])
        ds["PixelData"].VR = "OB"
    with pytest.raises(PreprocessingError) as error:
        preprocess_dicom_bytes(to_bytes(ds), multi)
    assert error.value.code == "UNSUPPORTED_TRANSFER_SYNTAX"


@pytest.mark.parametrize("data", [b"", b"not a dicom file" * 20, b"\x00" * 128 + b"DICM" + b"\x01" * 50])
def test_not_dicom(multi, data):
    with pytest.raises(PreprocessingError) as error:
        preprocess_dicom_bytes(data, multi)
    assert error.value.code == "NOT_DICOM"


# --- output contract and determinism -------------------------------------------


def test_output_contract(multi):
    result = preprocess_dicom_bytes(ct_bytes(phantom()), multi)
    assert result.tensor.shape == (224, 224, 3) == result.shape
    assert result.tensor.dtype == np.float32 and result.dtype == "float32"
    assert result.tensor.min() >= 0.0 and result.tensor.max() <= 1.0
    assert (result.original_rows, result.original_columns) == (64, 80)
    assert (result.output_rows, result.output_columns) == (224, 224)
    assert result.preprocessing_schema_version == 1


def test_same_dicom_and_config_give_identical_tensor(multi):
    data = ct_bytes(phantom(), pixel_spacing=(0.68, 0.71))
    first = preprocess_dicom_bytes(data, multi)
    for _ in range(3):
        again = preprocess_dicom_bytes(data, multi)
        assert again.tensor.tobytes() == first.tensor.tobytes()
        assert again.content_box == first.content_box


def test_tensor_digest_pinned_for_the_pinned_environment(multi, single):
    # Pinned-environment regression guard (Python 3.12, numpy 2.1.3, pydicom
    # 3.0.2); not a claim of bit identity on other runtimes.
    data = ct_bytes(phantom(), pixel_spacing=(0.68, 0.71))
    digests = [hashlib.sha256(preprocess_dicom_bytes(data, c).tensor.tobytes()).hexdigest() for c in (multi, single)]
    assert digests == PINNED_DIGESTS


PINNED_DIGESTS = [
    "6e22df0908167d5ea48984bea5a0fc279a1e448f8db47e0317c93eddd4e38ceb",
    "72ce385b4cc870e1aad16f072b7eff9dc99439871ef9325eba0d516863fd89c9",
]


# --- display attributes never influence the tensor -----------------------------


def test_monochrome1_and_monochrome2_give_identical_tensors(multi):
    m1 = preprocess_dicom_bytes(ct_bytes(phantom(), photometric="MONOCHROME1"), multi)
    m2 = preprocess_dicom_bytes(ct_bytes(phantom(), photometric="MONOCHROME2"), multi)
    assert np.array_equal(m1.tensor, m2.tensor)
    # Higher HU -> higher value: the bone ring is brighter than soft tissue.
    assert (m1.hu_min, m1.hu_max) == (m2.hu_min, m2.hu_max) == (-1000.0, 3071.0)


def test_display_window_attributes_are_ignored(multi):
    with_window = ct_dataset(phantom())
    without_window = ct_dataset(phantom())
    del without_window.WindowCenter
    del without_window.WindowWidth
    a = preprocess_dicom_bytes(to_bytes(with_window), multi).tensor
    b = preprocess_dicom_bytes(to_bytes(without_window), multi).tensor
    assert np.array_equal(a, b)


# --- padding -------------------------------------------------------------------


def test_declared_padding_becomes_zero_in_every_channel(multi):
    # Stored 1000 -> HU -24: inside the soft tissue and lung windows (so not 0
    # there) unless it is declared padding.
    stored = np.full((4, 4), 1024 + 40, dtype=np.int16)
    stored[0, :] = 1000
    config = with_size(multi, 4, 4)
    plain = preprocess_dicom_bytes(ct_bytes(stored), config)
    padded = preprocess_dicom_bytes(ct_bytes(stored, padding_value=1000), config)
    assert plain.tensor[0, 0].tolist() != [0.0, 0.0, 0.0]
    assert padded.tensor[0].tolist() == [[0.0, 0.0, 0.0]] * 4
    assert np.array_equal(padded.tensor[1:], plain.tensor[1:])
    assert padded.padding_pixel_count == 4 and plain.padding_pixel_count == 0
    assert (padded.hu_min, padded.hu_max) == (40.0, 40.0)  # padding excluded
    assert (plain.hu_min, plain.hu_max) == (-24.0, 40.0)


def test_padding_range_is_inclusive_in_either_order(multi):
    stored = np.array([[-3001, -3000, -2500, -2000], [-1999, 1064, 1064, 1064]], dtype=np.int16)
    config = with_size(multi, 2, 4)
    for value, limit in [(-3000, -2000), (-2000, -3000)]:
        result = preprocess_dicom_bytes(ct_bytes(stored, intercept=0, padding_value=value, padding_limit=limit), config)
        assert result.padding_pixel_count == 3
        assert (result.hu_min, result.hu_max) == (-3001.0, 1064.0)


def test_unsigned_padding_value(multi):
    stored = np.array([[0, 0], [1064, 1064]], dtype=np.uint16)
    result = preprocess_dicom_bytes(
        ct_bytes(stored, pixel_representation=0, bits_stored=12, padding_value=0), with_size(multi, 2, 2)
    )
    assert result.padding_pixel_count == 2
    assert result.tensor[0].tolist() == [[0.0, 0.0, 0.0]] * 2


def test_padding_is_mapped_before_windowing_and_resizing(multi):
    # Declared padding pixels are paddingHu (-2048) before the resize: a 2:1
    # downscale of [padding, 40 HU] gives half the soft tissue value, not the
    # value of whatever the padding stored value would rescale to.
    stored = np.array([[3000, 1064], [3000, 1064]], dtype=np.int16)  # 3000 -> 1976 HU if not padding
    result = preprocess_dicom_bytes(ct_bytes(stored, padding_value=3000), with_size(multi, 1, 1))
    assert result.tensor[0, 0, 0] == pytest.approx(0.25)  # (0 + 0.5) / 2


# --- no identifying data -----------------------------------------------------


def test_result_contains_no_identifying_values(multi):
    result = preprocess_dicom_bytes(ct_bytes(phantom()), multi)
    text = repr(result) + repr(dataclasses.asdict(result) | {"tensor": None})
    for sentinel in SENTINELS:
        assert sentinel not in text
    assert {f.name for f in dataclasses.fields(result)} == {
        "tensor",
        "shape",
        "dtype",
        "preprocessing_schema_version",
        "preprocessing_config_hash",
        "original_rows",
        "original_columns",
        "output_rows",
        "output_columns",
        "content_box",
        "hu_min",
        "hu_max",
        "padding_pixel_count",
    }
