"""Reading and validating one CT DICOM slice (schema version 1).

Delegated to pydicom (`Dataset.pixel_array`): decoding of the supported
transfer syntaxes, byte order, masking of the bits above BitsStored and
sign extension for PixelRepresentation 1 (verified by the tests). pydicom
does not apply the rescale, VOI windowing, pixel padding or a MONOCHROME1
inversion; ChildBEx applies the rescale and padding itself (`hu.py`) and
never applies VOI windowing or inversion.
"""

from __future__ import annotations

import io
import math
import re
import warnings
from dataclasses import dataclass

import numpy as np
import pydicom
from pydicom.dataset import Dataset
from pydicom.multival import MultiValue

from .errors import PreprocessingError

CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2"

IMPLICIT_VR_LE = "1.2.840.10008.1.2"
EXPLICIT_VR_LE = "1.2.840.10008.1.2.1"
RLE_LOSSLESS = "1.2.840.10008.1.2.5"

SUPPORTED_TRANSFER_SYNTAXES = (IMPLICIT_VR_LE, EXPLICIT_VR_LE, RLE_LOSSLESS)

# Reporting labels (standard transfer syntax UIDs are never printed).
TRANSFER_SYNTAX_LABELS = {
    IMPLICIT_VR_LE: "IMPLICIT_VR_LE",
    EXPLICIT_VR_LE: "EXPLICIT_VR_LE",
    RLE_LOSSLESS: "RLE_LOSSLESS",
    "1.2.840.10008.1.2.1.99": "DEFLATED_EXPLICIT_VR_LE",
    "1.2.840.10008.1.2.2": "EXPLICIT_VR_BE",
    "1.2.840.10008.1.2.4.50": "JPEG_BASELINE",
    "1.2.840.10008.1.2.4.51": "JPEG_EXTENDED",
    "1.2.840.10008.1.2.4.57": "JPEG_LOSSLESS",
    "1.2.840.10008.1.2.4.70": "JPEG_LOSSLESS_SV1",
    "1.2.840.10008.1.2.4.80": "JPEG_LS_LOSSLESS",
    "1.2.840.10008.1.2.4.81": "JPEG_LS_NEAR_LOSSLESS",
    "1.2.840.10008.1.2.4.90": "JPEG_2000_LOSSLESS",
    "1.2.840.10008.1.2.4.91": "JPEG_2000",
}

_CODE_STRING = re.compile(r"^[A-Z0-9_ ]{1,16}$")


@dataclass(frozen=True)
class ParsedDicom:
    dataset: Dataset
    # Transfer syntax used for decoding: from the file meta header, or for a
    # headerless data set the little endian encoding pydicom detected.
    transfer_syntax: str | None
    headerless: bool


@dataclass(frozen=True)
class CtSlice:
    """A validated, decoded CT slice (no identifying attributes)."""

    stored: np.ndarray  # (rows, columns) int16 or uint16, sign-corrected
    rows: int
    columns: int
    rescale_slope: float
    rescale_intercept: float
    row_spacing: float  # PixelSpacing[0]: mm between adjacent rows
    column_spacing: float  # PixelSpacing[1]: mm between adjacent columns
    # Inclusive stored-value range of declared padding, or None.
    padding_range: tuple[int, int] | None
    photometric_interpretation: str


def _has_part10_marker(data: bytes) -> bool:
    return len(data) >= 132 and data[128:132] == b"DICM"


def _is_image_like(ds: Dataset) -> bool:
    """The importer's image guard (apps/be dicom.service.ts `readSliceMeta`;
    other data sets are skipped there as not_an_image / not_dicom):
    SOPInstanceUID, a complete ImagePositionPatient / ImageOrientationPatient,
    Rows and Columns."""
    try:
        return bool(
            ds.get("SOPInstanceUID")
            and len(ds.get("ImagePositionPatient") or []) == 3
            and len(ds.get("ImageOrientationPatient") or []) == 6
            and int(ds.get("Rows") or 0) > 0
            and int(ds.get("Columns") or 0) > 0
        )
    except Exception:
        return False


def parse_dicom(data: bytes) -> ParsedDicom:
    """Parses DICOM bytes as the backend importer accepts them.

    Files with the Part-10 "DICM" marker are read with their file meta
    header. Without it, the bytes are read as a raw little endian data set
    (implicit or explicit VR, as detected by pydicom). Either way the data
    set must pass the importer's image guard.
    """
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            if _has_part10_marker(data):
                ds = pydicom.dcmread(io.BytesIO(data))
                if not _is_image_like(ds):
                    raise PreprocessingError("NOT_DICOM")
                ts = ds.file_meta.get("TransferSyntaxUID")
                return ParsedDicom(ds, str(ts) if ts else None, headerless=False)
            ds = pydicom.dcmread(io.BytesIO(data), force=True)
        except PreprocessingError:
            raise
        except Exception:
            raise PreprocessingError("NOT_DICOM") from None
        ts = ds.file_meta.get("TransferSyntaxUID") if ds.file_meta is not None else None
        if ts:
            return ParsedDicom(ds, str(ts), headerless=False)
        try:
            implicit, little = ds.original_encoding
        except Exception:
            raise PreprocessingError("NOT_DICOM") from None
        if not _is_image_like(ds):
            raise PreprocessingError("NOT_DICOM")
        if little is not True or implicit is None:
            return ParsedDicom(ds, None, headerless=True)
        return ParsedDicom(ds, IMPLICIT_VR_LE if implicit else EXPLICIT_VR_LE, headerless=True)


def transfer_syntax_label(parsed: ParsedDicom) -> str:
    if parsed.transfer_syntax is None:
        return "HEADERLESS_UNKNOWN" if parsed.headerless else "MISSING"
    label = TRANSFER_SYNTAX_LABELS.get(parsed.transfer_syntax, "OTHER")
    return f"HEADERLESS_{label}" if parsed.headerless else label


def modality_label(ds: Dataset) -> str | None:
    """Modality as a safe code string (never free text), or None."""
    try:
        value = ds.get("Modality")
    except Exception:
        return "INVALID"
    if value is None or value == "":
        return None
    text = str(value)
    return text if _CODE_STRING.match(text) else "INVALID"


def safe_dimension(ds: Dataset, keyword: str) -> int | None:
    try:
        value = ds.get(keyword)
        return int(value) if value is not None and value != "" else None
    except Exception:
        return None


def _single_float(ds: Dataset, keyword: str, missing: str, invalid: str) -> float:
    try:
        value = ds.get(keyword)
    except Exception:
        raise PreprocessingError(invalid) from None
    if value is None or value == "":
        raise PreprocessingError(missing)
    if isinstance(value, (MultiValue, list, tuple, bytes)):
        raise PreprocessingError(invalid)
    try:
        number = float(value)
    except Exception:
        raise PreprocessingError(invalid) from None
    if not math.isfinite(number):
        raise PreprocessingError(invalid)
    return number


def _required_int(ds: Dataset, keyword: str) -> int:
    try:
        value = ds.get(keyword)
        if value is None or value == "" or isinstance(value, (MultiValue, list, tuple)):
            raise ValueError
        return int(value)
    except Exception:
        raise PreprocessingError("UNSUPPORTED_PIXEL_FORMAT") from None


def _padding_value(ds: Dataset, keyword: str) -> int | None:
    try:
        value = ds.get(keyword)
    except Exception:
        raise PreprocessingError("INVALID_PIXEL_PADDING") from None
    if value is None or value == "" or value == b"":
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise PreprocessingError("INVALID_PIXEL_PADDING")
    try:
        return int(value)
    except Exception:
        raise PreprocessingError("INVALID_PIXEL_PADDING") from None


def validate_and_decode(parsed: ParsedDicom) -> CtSlice:
    """Checks, in this order, then decodes the stored pixel values."""
    ds = parsed.dataset
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        if modality_label(ds) != "CT":
            raise PreprocessingError("UNSUPPORTED_MODALITY")
        try:
            sop_class = str(ds.get("SOPClassUID") or "")
        except Exception:
            sop_class = ""
        if sop_class != CT_IMAGE_STORAGE:
            raise PreprocessingError("UNSUPPORTED_SOP_CLASS")

        if "NumberOfFrames" in ds:
            try:
                frames = ds.get("NumberOfFrames")
                frames = 1 if frames is None or frames == "" else int(frames)
            except Exception:
                frames = -1
            if frames != 1:
                raise PreprocessingError("UNSUPPORTED_MULTI_FRAME")

        if parsed.transfer_syntax not in SUPPORTED_TRANSFER_SYNTAXES:
            raise PreprocessingError("UNSUPPORTED_TRANSFER_SYNTAX")

        rows = _required_int(ds, "Rows")
        columns = _required_int(ds, "Columns")
        samples = _required_int(ds, "SamplesPerPixel")
        bits_allocated = _required_int(ds, "BitsAllocated")
        bits_stored = _required_int(ds, "BitsStored")
        high_bit = _required_int(ds, "HighBit")
        representation = _required_int(ds, "PixelRepresentation")
        try:
            photometric = str(ds.get("PhotometricInterpretation") or "")
        except Exception:
            photometric = ""
        if not (
            rows > 0
            and columns > 0
            and samples == 1
            and bits_allocated == 16
            and 12 <= bits_stored <= 16
            and high_bit == bits_stored - 1
            and representation in (0, 1)
            and photometric in ("MONOCHROME1", "MONOCHROME2")
        ):
            raise PreprocessingError("UNSUPPORTED_PIXEL_FORMAT")

        if "ModalityLUTSequence" in ds:
            raise PreprocessingError("UNSUPPORTED_MODALITY_LUT")
        slope = _single_float(ds, "RescaleSlope", "MISSING_CT_RESCALE", "INVALID_CT_RESCALE")
        intercept = _single_float(ds, "RescaleIntercept", "MISSING_CT_RESCALE", "INVALID_CT_RESCALE")
        if slope <= 0:
            raise PreprocessingError("INVALID_CT_RESCALE")
        try:
            rescale_type = ds.get("RescaleType")
        except Exception:
            raise PreprocessingError("UNSUPPORTED_RESCALE_TYPE") from None
        if rescale_type not in (None, "") and str(rescale_type).strip() != "HU":
            raise PreprocessingError("UNSUPPORTED_RESCALE_TYPE")

        try:
            spacing = ds.get("PixelSpacing")
            spacing = [float(value) for value in spacing] if spacing not in (None, "") else None
        except Exception:
            spacing = None
        if (
            spacing is None
            or len(spacing) != 2
            or not all(math.isfinite(value) and value > 0 for value in spacing)
        ):
            raise PreprocessingError("INVALID_PIXEL_SPACING")

        dtype = np.dtype(np.int16 if representation == 1 else np.uint16)
        info = np.iinfo(dtype)
        padding_value = _padding_value(ds, "PixelPaddingValue")
        padding_limit = _padding_value(ds, "PixelPaddingRangeLimit")
        padding_range = None
        if padding_limit is not None and padding_value is None:
            raise PreprocessingError("INVALID_PIXEL_PADDING")
        if padding_value is not None:
            bounds = [padding_value] if padding_limit is None else [padding_value, padding_limit]
            if not all(info.min <= value <= info.max for value in bounds):
                raise PreprocessingError("INVALID_PIXEL_PADDING")
            padding_range = (min(bounds), max(bounds))

        if "PixelData" not in ds:
            raise PreprocessingError("PIXEL_DATA_DECODE_FAILED")
        if parsed.headerless:
            # pydicom needs the transfer syntax to decode; for a headerless
            # data set it is the encoding it detected (checked above).
            ds.file_meta.TransferSyntaxUID = parsed.transfer_syntax
        try:
            stored = ds.pixel_array
        except Exception:
            raise PreprocessingError("PIXEL_DATA_DECODE_FAILED") from None
        if stored.shape != (rows, columns) or stored.dtype != dtype:
            raise PreprocessingError("PIXEL_DATA_DECODE_FAILED")

    return CtSlice(
        stored=stored,
        rows=rows,
        columns=columns,
        rescale_slope=slope,
        rescale_intercept=intercept,
        row_spacing=spacing[0],
        column_spacing=spacing[1],
        padding_range=padding_range,
        photometric_interpretation=photometric,
    )
