"""Privacy-minimized cloud training artifact (`CHILDBEX_CT_SLICE_TENSORS_V1`).

Importing this package loads only the NumPy-only reader side; the
controlled-side builder (`cloud_artifact.build`, which needs pydicom and a
PR10 export) is imported explicitly.
"""

from .errors import CloudArtifactError
from .manifest import ARTIFACT_SCHEMA_VERSION, KIND, LABEL_ENCODING, artifact_sha256, validate_manifest
from .reader import CloudArtifact, CloudSample

__all__ = [
    "ARTIFACT_SCHEMA_VERSION",
    "KIND",
    "LABEL_ENCODING",
    "CloudArtifact",
    "CloudArtifactError",
    "CloudSample",
    "artifact_sha256",
    "validate_manifest",
]
