"""Controlled-side privacy gates for external (cloud) training artifacts."""

from .attestation import AttestationError, load_attestation, validate_attestation
from .pixel_gate import PIXEL_GATE_VERSION, PixelGateError, check_pixel_gate

__all__ = [
    "AttestationError",
    "PIXEL_GATE_VERSION",
    "PixelGateError",
    "check_pixel_gate",
    "load_attestation",
    "validate_attestation",
]
