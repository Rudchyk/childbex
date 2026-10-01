"""Synthetic CT DICOM files built in memory (no real patient data).

Every file carries sentinel identifying values so tests can prove that no
output repeats them.
"""

from __future__ import annotations

import io

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.filebase import DicomBytesIO
from pydicom.filewriter import write_dataset
from pydicom.uid import (
    CTImageStorage,
    DeflatedExplicitVRLittleEndian,
    ExplicitVRBigEndian,
    ExplicitVRLittleEndian,
    ImplicitVRLittleEndian,
    JPEGLosslessSV1,
    RLELossless,
)

SENTINEL_NAME = "SENTINEL^PHI^NAME"
SENTINEL_PATIENT_ID = "SENTINELPID42"
SENTINEL_STUDY_UID = "1.2.826.0.1.3680043.10.4242.1"
SENTINEL_SERIES_UID = "1.2.826.0.1.3680043.10.4242.2"
SENTINEL_SOP_UID = "1.2.826.0.1.3680043.10.4242.3"
SENTINEL_FILE_NAME = "SENTINEL_FILE_NAME_7f3a.dcm"
SECONDARY_CAPTURE = "1.2.840.10008.5.1.4.1.1.7"
ENHANCED_CT = "1.2.840.10008.5.1.4.1.1.2.1"

_OMIT = object()


def ct_dataset(
    stored: np.ndarray | None = None,
    *,
    raw_words: np.ndarray | None = None,
    bits_stored: int = 16,
    pixel_representation: int = 1,
    slope=1,
    intercept=-1024,
    rescale_type=_OMIT,
    photometric: str = "MONOCHROME2",
    pixel_spacing=(0.7, 0.7),
    padding_value=None,
    padding_limit=None,
    modality="CT",
    sop_class: str = CTImageStorage,
    transfer_syntax=ExplicitVRLittleEndian,
    frames: int | None = None,
    bits_allocated: int = 16,
    samples_per_pixel: int = 1,
    high_bit: int | None = None,
) -> Dataset:
    """A CT Image Storage data set; `stored` holds signed/unsigned stored
    values, `raw_words` the exact 16-bit words (e.g. garbage high bits)."""
    if raw_words is None:
        if stored is None:
            stored = np.arange(16, dtype=np.int16).reshape(4, 4)
        dtype = "<i2" if pixel_representation == 1 else "<u2"
        pixel_bytes = np.ascontiguousarray(stored, dtype=dtype).tobytes()
        shape = stored.shape
    else:
        pixel_bytes = np.ascontiguousarray(raw_words, dtype="<u2").tobytes()
        shape = raw_words.shape
    rows, columns = shape[-2], shape[-1]

    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = transfer_syntax
    ds.file_meta.MediaStorageSOPClassUID = sop_class
    ds.file_meta.MediaStorageSOPInstanceUID = SENTINEL_SOP_UID
    ds.PatientName = SENTINEL_NAME
    ds.PatientID = SENTINEL_PATIENT_ID
    ds.StudyInstanceUID = SENTINEL_STUDY_UID
    ds.SeriesInstanceUID = SENTINEL_SERIES_UID
    ds.SOPInstanceUID = SENTINEL_SOP_UID
    ds.SOPClassUID = sop_class
    if modality is not None:
        ds.Modality = modality
    ds.ImagePositionPatient = [0, 0, 0]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    ds.Rows = rows
    ds.Columns = columns
    ds.SamplesPerPixel = samples_per_pixel
    ds.PhotometricInterpretation = photometric
    ds.BitsAllocated = bits_allocated
    ds.BitsStored = bits_stored
    ds.HighBit = bits_stored - 1 if high_bit is None else high_bit
    ds.PixelRepresentation = pixel_representation
    if pixel_spacing is not None:
        ds.PixelSpacing = list(pixel_spacing)
    if slope is not None:
        ds.RescaleSlope = slope
    if intercept is not None:
        ds.RescaleIntercept = intercept
    if rescale_type is not _OMIT:
        ds.RescaleType = rescale_type
    # Display windows that must never be used by preprocessing.
    ds.WindowCenter = 12345
    ds.WindowWidth = 3
    if padding_value is not None:
        ds.PixelPaddingValue = padding_value
    if padding_limit is not None:
        ds.PixelPaddingRangeLimit = padding_limit
    if frames is not None:
        ds.NumberOfFrames = frames
    ds.PixelData = pixel_bytes
    ds["PixelData"].VR = "OW"
    return ds


def to_bytes(ds: Dataset, *, headerless: bool = False) -> bytes:
    ts = ds.file_meta.TransferSyntaxUID
    if headerless:
        fp = DicomBytesIO()
        fp.is_implicit_VR = ts == ImplicitVRLittleEndian
        fp.is_little_endian = True
        write_dataset(fp, ds)
        return fp.getvalue()
    if ts == JPEGLosslessSV1:
        # Not decodable here; the preprocessor must reject it by its syntax.
        ds.PixelData = encapsulate([b"\xff\xd8\xff\xc3" + b"\x00" * 60 + b"\xff\xd9"])
        ds["PixelData"].VR = "OB"
    buffer = io.BytesIO()
    ds.save_as(
        buffer,
        enforce_file_format=True,
        implicit_vr=ts == ImplicitVRLittleEndian,
        little_endian=ts != ExplicitVRBigEndian,
    )
    return buffer.getvalue()


def ct_bytes(stored: np.ndarray | None = None, **kwargs) -> bytes:
    headerless = kwargs.pop("headerless", False)
    ds = ct_dataset(stored, **kwargs)
    if kwargs.get("transfer_syntax") == RLELossless:
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.compress(RLELossless)
    return to_bytes(ds, headerless=headerless)


__all__ = [
    "DeflatedExplicitVRLittleEndian",
    "ENHANCED_CT",
    "ExplicitVRBigEndian",
    "ExplicitVRLittleEndian",
    "ImplicitVRLittleEndian",
    "JPEGLosslessSV1",
    "RLELossless",
    "SECONDARY_CAPTURE",
    "ct_bytes",
    "ct_dataset",
    "to_bytes",
]
