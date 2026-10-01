"""PIXEL_GATE_V1: may the pixels of this original DICOM image enter a cloud
training artifact?

Evaluated on the verified original DICOM bytes, parsed with the canonical PR9
parser (`preprocessing.dicom.parse_dicom`: the same acceptance and image
guard). Rules, in this order:

1. SOP Class UID = CT Image Storage, else `UNSUPPORTED_SOP_CLASS`.
2. BurnedInAnnotation (0028,0301): `YES` (or any value other than absent /
   empty / `NO`) -> `BURNED_IN_ANNOTATION`.
3. RecognizableVisualFeatures (0028,0302): same -> `RECOGNIZABLE_VISUAL_FEATURES`.
4. ImageType (0008,0008): at least 3 values with value 1 = ORIGINAL,
   value 2 = PRIMARY, value 3 = AXIAL; later values are allowed but prove
   nothing. Missing or anything else -> `UNSAFE_IMAGE_TYPE`.

Passing the gate does NOT establish that the pixels are free of burned-in
text: an absent or `NO` BurnedInAnnotation is vendor-asserted at best. A cloud
artifact additionally requires the structured human pixel-review
attestation (`attestation.py`). No OCR.
"""

from __future__ import annotations

import warnings

from pydicom.multival import MultiValue

from ..preprocessing.dicom import CT_IMAGE_STORAGE, parse_dicom

PIXEL_GATE_VERSION = "PIXEL_GATE_V1"
REQUIRED_IMAGE_TYPE_PREFIX = ("ORIGINAL", "PRIMARY", "AXIAL")

GATE_CODES = (
    "UNSUPPORTED_SOP_CLASS",
    "BURNED_IN_ANNOTATION",
    "RECOGNIZABLE_VISUAL_FEATURES",
    "UNSAFE_IMAGE_TYPE",
)


class PixelGateError(Exception):
    def __init__(self, code: str) -> None:
        if code not in GATE_CODES:
            raise ValueError("unknown pixel gate code")
        super().__init__(f"{PIXEL_GATE_VERSION} rejected the image: {code}")
        self.code = code


def _flag_is_clear(ds, keyword: str) -> bool:
    """Absent, empty or NO; YES and anything unexpected is not clear."""
    try:
        value = ds.get(keyword)
    except Exception:
        return False
    if value is None or value == "":
        return True
    return isinstance(value, str) and value.strip() == "NO"


def _image_type(ds) -> tuple[str, ...] | None:
    try:
        value = ds.get("ImageType")
    except Exception:
        return None
    if value is None or value == "":
        return None
    values = list(value) if isinstance(value, (MultiValue, list, tuple)) else [value]
    if not all(isinstance(component, str) for component in values):
        return None
    return tuple(component.strip() for component in values)


def check_pixel_gate(data: bytes) -> None:
    """Raises PixelGateError (or PR9 PreprocessingError NOT_DICOM)."""
    parsed = parse_dicom(data)
    ds = parsed.dataset
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            sop_class = str(ds.get("SOPClassUID") or "")
        except Exception:
            sop_class = ""
        if sop_class != CT_IMAGE_STORAGE:
            raise PixelGateError("UNSUPPORTED_SOP_CLASS")
        if not _flag_is_clear(ds, "BurnedInAnnotation"):
            raise PixelGateError("BURNED_IN_ANNOTATION")
        if not _flag_is_clear(ds, "RecognizableVisualFeatures"):
            raise PixelGateError("RECOGNIZABLE_VISUAL_FEATURES")
        image_type = _image_type(ds)
        if image_type is None or image_type[:3] != REQUIRED_IMAGE_TYPE_PREFIX:
            raise PixelGateError("UNSAFE_IMAGE_TYPE")
