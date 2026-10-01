"""Machine-readable preprocessing errors.

Messages are fixed per code: they never contain values read from a file
(no UIDs, names, paths or pixel values).
"""

MESSAGES: dict[str, str] = {
    "NOT_DICOM": "The input is not a readable DICOM image data set.",
    "UNSUPPORTED_MODALITY": "Only Modality CT is supported.",
    "UNSUPPORTED_SOP_CLASS": "Only CT Image Storage is supported.",
    "UNSUPPORTED_MULTI_FRAME": "Multi-frame images are not supported.",
    "UNSUPPORTED_TRANSFER_SYNTAX": "The transfer syntax is not supported.",
    "UNSUPPORTED_PIXEL_FORMAT": "The pixel format is not a supported CT format.",
    "UNSUPPORTED_MODALITY_LUT": "A Modality LUT Sequence is not supported.",
    "MISSING_CT_RESCALE": "RescaleSlope or RescaleIntercept is missing.",
    "INVALID_CT_RESCALE": "RescaleSlope or RescaleIntercept is invalid.",
    "UNSUPPORTED_RESCALE_TYPE": "RescaleType is present and not HU.",
    "INVALID_PIXEL_SPACING": "PixelSpacing is missing or invalid.",
    "INVALID_PIXEL_PADDING": "The declared pixel padding is invalid.",
    "PIXEL_DATA_DECODE_FAILED": "The pixel data could not be decoded.",
    "FILE_NOT_READABLE": "The file could not be read.",
    "FILE_INTEGRITY_MISMATCH": "The file does not match its expected size or SHA-256.",
}


class PreprocessingError(Exception):
    """A slice that cannot be preprocessed under the configuration version."""

    def __init__(self, code: str) -> None:
        if code not in MESSAGES:
            raise ValueError("unknown preprocessing error code")
        super().__init__(MESSAGES[code])
        self.code = code


class ConfigError(ValueError):
    """An invalid preprocessing configuration (messages name keys, not data)."""
