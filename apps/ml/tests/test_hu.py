"""Stored values -> HU, rescale policy, CT object validation, padding."""

import numpy as np
import pytest
from pydicom.dataset import Dataset
from pydicom.sequence import Sequence

from childbex_ml.preprocessing import PreprocessingError
from childbex_ml.preprocessing.dicom import parse_dicom, validate_and_decode
from childbex_ml.preprocessing.hu import stored_to_hu
from synthetic import ENHANCED_CT, SECONDARY_CAPTURE, ct_bytes, ct_dataset, to_bytes


def decode(data: bytes):
    return validate_and_decode(parse_dicom(data))


def hu_of(data: bytes) -> np.ndarray:
    ct = decode(data)
    return stored_to_hu(ct.stored, ct.rescale_slope, ct.rescale_intercept)


def code_of(data: bytes) -> str:
    with pytest.raises(PreprocessingError) as error:
        decode(data)
    return error.value.code


def test_unsigned_stored_pixels():
    stored = np.array([[0, 1024], [2047, 4095]], dtype=np.uint16)
    data = ct_bytes(stored, pixel_representation=0, bits_stored=12, slope=1, intercept=-1024)
    ct = decode(data)
    assert ct.stored.dtype == np.uint16
    assert ct.stored.tolist() == [[0, 1024], [2047, 4095]]
    assert hu_of(data).tolist() == [[-1024.0, 0.0], [1023.0, 3071.0]]


def test_signed_stored_pixels():
    stored = np.array([[-2000, -1024], [0, 3000]], dtype=np.int16)
    data = ct_bytes(stored, pixel_representation=1, slope=1, intercept=0)
    ct = decode(data)
    assert ct.stored.dtype == np.int16
    assert hu_of(data).tolist() == [[-2000.0, -1024.0], [0.0, 3000.0]]


def test_bits_stored_below_bits_allocated_signed_masks_and_sign_extends():
    # 12-bit two's complement with garbage in the 4 unused high bits:
    # 0xAFFB -> 0xFFB = -5, 0x07FF = 2047, 0x0800 = -2048, 0x5001 -> 1.
    words = np.array([[0xAFFB, 0x07FF], [0x0800, 0x5001]], dtype=np.uint16)
    data = ct_bytes(raw_words=words, bits_stored=12, pixel_representation=1, slope=1, intercept=0)
    assert decode(data).stored.tolist() == [[-5, 2047], [-2048, 1]]
    assert hu_of(data).tolist() == [[-5.0, 2047.0], [-2048.0, 1.0]]


def test_bits_stored_below_bits_allocated_unsigned_masks_high_bits():
    words = np.array([[0xAFFB, 0x07FF], [0x0800, 0x5001]], dtype=np.uint16)
    data = ct_bytes(raw_words=words, bits_stored=12, pixel_representation=0, slope=1, intercept=-1024)
    assert decode(data).stored.tolist() == [[0xFFB, 0x7FF], [0x800, 0x001]]
    assert hu_of(data).tolist() == [[4091 - 1024.0, 2047 - 1024.0], [2048 - 1024.0, 1 - 1024.0]]


def test_non_default_slope_and_negative_intercept_exact():
    stored = np.array([[-3, 0], [1, 2000]], dtype=np.int16)
    data = ct_bytes(stored, slope=0.5, intercept=-1024.25)
    # Exactly representable in float32.
    assert hu_of(data).tolist() == [[-1025.75, -1024.25], [-1023.75, -24.25]]


def test_hu_formula_is_float32_multiply_then_add():
    stored = np.array([[-1000, -1], [7, 32767]], dtype=np.int16)
    slope, intercept = 1.1, -1024.3
    hu = hu_of(ct_bytes(stored, slope=slope, intercept=intercept))
    assert hu.dtype == np.float32
    expected = (stored.astype(np.float32) * np.float32(slope)).astype(np.float32) + np.float32(intercept)
    assert np.array_equal(hu, expected.astype(np.float32))
    exact = stored.astype(np.float64) * slope + intercept
    assert np.allclose(hu, exact, rtol=0, atol=0.01)


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"slope": None}, "MISSING_CT_RESCALE"),
        ({"intercept": None}, "MISSING_CT_RESCALE"),
        ({"slope": None, "intercept": None}, "MISSING_CT_RESCALE"),
        ({"slope": 0}, "INVALID_CT_RESCALE"),
        ({"slope": -1}, "INVALID_CT_RESCALE"),
        ({"slope": [1, 2]}, "INVALID_CT_RESCALE"),
        ({"intercept": [-1024, 0]}, "INVALID_CT_RESCALE"),
        ({"rescale_type": "US"}, "UNSUPPORTED_RESCALE_TYPE"),
        ({"rescale_type": "OD"}, "UNSUPPORTED_RESCALE_TYPE"),
    ],
)
def test_rescale_policy(changes, code):
    assert code_of(ct_bytes(**changes)) == code


def test_rescale_type_hu_is_accepted():
    assert decode(ct_bytes(rescale_type="HU")).rescale_intercept == -1024


def test_modality_lut_sequence_is_rejected():
    ds = ct_dataset()
    item = Dataset()
    item.LUTDescriptor = [2, 0, 16]
    item.ModalityLUTType = "HU"
    item.add_new(0x00283006, "US", [0, 1])  # LUTData
    ds.ModalityLUTSequence = Sequence([item])
    assert code_of(to_bytes(ds)) == "UNSUPPORTED_MODALITY_LUT"


@pytest.mark.parametrize("modality", ["MR", "CR", "DX", "PT", "OT", None])
def test_non_ct_modality_rejected(modality):
    assert code_of(ct_bytes(modality=modality)) == "UNSUPPORTED_MODALITY"


@pytest.mark.parametrize("sop_class", [ENHANCED_CT, SECONDARY_CAPTURE, "1.2.840.10008.5.1.4.1.1.4"])
def test_non_ct_image_storage_rejected(sop_class):
    assert code_of(ct_bytes(sop_class=sop_class)) == "UNSUPPORTED_SOP_CLASS"


@pytest.mark.parametrize(
    "changes",
    [
        {"samples_per_pixel": 3},
        {"bits_allocated": 8},
        {"bits_allocated": 32},
        {"bits_stored": 11},
        {"high_bit": 14},
        {"pixel_representation": 2},
        {"photometric": "RGB"},
        {"photometric": "PALETTE COLOR"},
    ],
)
def test_unsupported_pixel_format(changes):
    assert code_of(ct_bytes(**changes)) == "UNSUPPORTED_PIXEL_FORMAT"


def test_multi_frame_rejected_single_frame_accepted():
    frames = np.zeros((2, 4, 4), dtype=np.int16)
    assert code_of(ct_bytes(frames, frames=2)) == "UNSUPPORTED_MULTI_FRAME"
    assert decode(ct_bytes(frames=1)).stored.shape == (4, 4)


@pytest.mark.parametrize("spacing", [None, [0.0, 0.7], [0.7, -0.7], [0.7], [0.7, 0.7, 0.7]])
def test_invalid_pixel_spacing_rejected(spacing):
    if spacing is None:
        data = ct_bytes(pixel_spacing=None)
    else:
        ds = ct_dataset()
        ds.PixelSpacing = spacing
        data = to_bytes(ds)
    assert code_of(data) == "INVALID_PIXEL_SPACING"


def test_pixel_spacing_order_is_row_then_column():
    ct = decode(ct_bytes(pixel_spacing=(0.5, 0.8)))
    assert (ct.row_spacing, ct.column_spacing) == (0.5, 0.8)


def test_padding_value_is_read_in_stored_space():
    signed = decode(ct_bytes(padding_value=-2000))
    assert signed.padding_range == (-2000, -2000)
    ranged = decode(ct_bytes(padding_value=-1000, padding_limit=-3000))
    assert ranged.padding_range == (-3000, -1000)
    unsigned = decode(ct_bytes(pixel_representation=0, bits_stored=12, padding_value=0))
    assert unsigned.padding_range == (0, 0)


def test_padding_range_limit_without_value_is_invalid():
    assert code_of(ct_bytes(padding_limit=-2000)) == "INVALID_PIXEL_PADDING"
