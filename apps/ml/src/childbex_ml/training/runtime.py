"""TRAINING_RUNTIME_V1: the exact runtime an official PR11 run requires.

A future dependency upgrade gets a new profile; this one is never widened.
TensorFlow is imported lazily so the profile can be checked (and fail with
UNSUPPORTED_RUNTIME) where TensorFlow is not installed.
"""

from __future__ import annotations

import importlib.metadata
import platform
import sys

from .. import __version__
from .errors import TrainingError

RUNTIME_PROFILE = "TRAINING_RUNTIME_V1"
REQUIRED = {"tensorflow": "2.20.0", "keras": "3.11.3", "numpy": "2.1.3"}
PYTHON = ((3, 12), (3, 13))  # >=3.12, <3.13


def _installed(distribution: str) -> str | None:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def installed_versions() -> dict:
    return {
        "python": platform.python_version(),
        **{name: _installed(name) for name in REQUIRED},
    }


def check_runtime(versions: dict | None = None, python_info: tuple[int, int] | None = None) -> dict:
    """Raises UNSUPPORTED_RUNTIME unless the runtime matches the profile exactly."""
    versions = versions if versions is not None else installed_versions()
    major_minor = python_info if python_info is not None else sys.version_info[:2]
    if not PYTHON[0] <= tuple(major_minor) < PYTHON[1]:
        raise TrainingError("UNSUPPORTED_RUNTIME", "python")
    for name, required in REQUIRED.items():
        if versions.get(name) != required:
            raise TrainingError("UNSUPPORTED_RUNTIME", name)
    return versions


def describe_runtime() -> dict:
    """Actual runtime and devices (recorded in runtime.json; never hashed)."""
    import keras
    import numpy
    import tensorflow as tf

    build = tf.sysconfig.get_build_info()
    devices = []
    for device in tf.config.list_physical_devices():
        entry = {"type": device.device_type}
        if device.device_type == "GPU":
            try:
                details = tf.config.experimental.get_device_details(device)
                entry.update({k: str(v) for k, v in details.items()})
            except Exception:
                entry["details"] = "unavailable"
        devices.append(entry)
    return {
        "runtimeProfile": RUNTIME_PROFILE,
        "childbexMlVersion": __version__,
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "tensorflowVersion": tf.__version__,
        "kerasVersion": keras.__version__,
        "numpyVersion": numpy.__version__,
        "platform": platform.platform(terse=True),
        "machine": platform.machine(),
        "tensorflowBuild": {
            key: str(build.get(key))
            for key in ("is_cuda_build", "is_rocm_build", "cuda_version", "cudnn_version")
            if key in build
        },
        "devices": devices,
    }
