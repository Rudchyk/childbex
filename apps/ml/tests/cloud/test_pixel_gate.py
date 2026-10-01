"""PIXEL_GATE_V1 on synthetic DICOM."""

import pytest

from childbex_ml.preprocessing import PreprocessingError
from childbex_ml.privacy import PixelGateError, check_pixel_gate
from synthetic import ENHANCED_CT, SECONDARY_CAPTURE, ct_bytes


def gate_code(**kwargs) -> str | None:
    try:
        check_pixel_gate(ct_bytes(**kwargs))
    except PixelGateError as error:
        return error.code
    return None


@pytest.mark.parametrize(
    "image_type",
    [
        ("ORIGINAL", "PRIMARY", "AXIAL"),
        ("ORIGINAL", "PRIMARY", "AXIAL", "HELIX"),
        ("ORIGINAL", "PRIMARY", "AXIAL", "CT_SOM5 SPI", "VOLUME"),
    ],
)
def test_original_primary_axial_passes_with_or_without_trailing_values(image_type):
    assert gate_code(image_type=image_type) is None


@pytest.mark.parametrize(
    "image_type",
    [
        None,  # missing
        ("ORIGINAL",),
        ("ORIGINAL", "PRIMARY"),  # fewer than 3 values
        ("DERIVED", "PRIMARY", "AXIAL"),  # first
        ("ORIGINAL", "SECONDARY", "AXIAL"),  # second
        ("ORIGINAL", "PRIMARY", "LOCALIZER"),  # third
        ("DERIVED", "SECONDARY", "REFORMATTED"),
        ("ORIGINAL", "PRIMARY", "OTHER", "AXIAL"),  # AXIAL elsewhere does not count
    ],
)
def test_unsafe_image_types_fail(image_type):
    assert gate_code(image_type=image_type) == "UNSAFE_IMAGE_TYPE"


def test_burned_in_annotation():
    assert gate_code(burned_in_annotation="YES") == "BURNED_IN_ANNOTATION"
    assert gate_code(burned_in_annotation="NO") is None
    assert gate_code() is None  # absent: not a failure by itself (attestation still required)
    assert gate_code(burned_in_annotation="UNKNOWN") == "BURNED_IN_ANNOTATION"  # unexpected value is not clear


def test_recognizable_visual_features():
    assert gate_code(recognizable_visual_features="YES") == "RECOGNIZABLE_VISUAL_FEATURES"
    assert gate_code(recognizable_visual_features="NO") is None


@pytest.mark.parametrize("sop_class", [SECONDARY_CAPTURE, ENHANCED_CT, "1.2.840.10008.5.1.4.1.1.4"])
def test_non_ct_image_storage_fails(sop_class):
    assert gate_code(sop_class=sop_class) == "UNSUPPORTED_SOP_CLASS"


def test_rule_order_sop_class_first():
    assert gate_code(sop_class=SECONDARY_CAPTURE, burned_in_annotation="YES", image_type=None) == "UNSUPPORTED_SOP_CLASS"


def test_not_dicom_uses_the_pr9_parser():
    with pytest.raises(PreprocessingError) as error:
        check_pixel_gate(b"not a dicom file" * 20)
    assert error.value.code == "NOT_DICOM"
