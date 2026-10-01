"""The ML runtime a preflight was run in.

PR9 preprocessing is deterministic within its pinned runtime; bit identity
across runtimes is not claimed. A preflight report is therefore bound to the
runtime that produced it, and training must run in the same runtime (or
preflight again there).
"""

from __future__ import annotations

import platform

import numpy
import pydicom

from .. import __version__


def runtime_fingerprint() -> dict:
    return {
        "childbexMlVersion": __version__,
        "pythonImplementation": platform.python_implementation(),
        "pythonVersion": platform.python_version(),
        "numpyVersion": numpy.__version__,
        "pydicomVersion": pydicom.__version__,
    }
