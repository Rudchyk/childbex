"""Machine-readable training errors (fixed messages; `detail` names a schema
location, a version or an upstream error code, never a value from data)."""

from __future__ import annotations

MESSAGES: dict[str, str] = {
    "INVALID_TRAINING_CONFIG": "The training configuration does not follow training schema version 1.",
    "UNSUPPORTED_RUNTIME": "The runtime does not match TRAINING_RUNTIME_V1.",
    "DETERMINISM_UNAVAILABLE": "Strict deterministic execution is not available in this runtime.",
    "ARTIFACT_INVALID": "The cloud artifact failed verification.",
    "ARTIFACT_MISMATCH": "The cloud artifact is not the one bound in the training configuration.",
    "UNSUPPORTED_ARTIFACT_SCHEMA": "The cloud artifact schema is not supported.",
    "INCOMPATIBLE_TENSOR_CONTRACT": "The artifact tensors do not match the 224x224x3 float32 HWC [0,1] contract.",
    "UNSUPPORTED_PREPROCESSING_CONFIG": "The artifact preprocessing configuration is not supported.",
    "NO_TRAIN_SAMPLES": "The artifact has no TRAIN samples.",
    "NO_VALIDATION_SAMPLES": "The artifact has no VALIDATION samples.",
    "TRAIN_CLASS_MISSING": "TRAIN does not contain both classes.",
    "VALIDATION_CLASS_MISSING": "VALIDATION does not contain both classes.",
    "TEST_ACCESS_FORBIDDEN": "TEST data must not be accessed during training.",
    "MODEL_INPUT_MISMATCH": "The model input does not match the artifact tensor contract.",
    "MODEL_STRUCTURE_MISMATCH": "The backbone layer structure differs from the fine-tuning contract.",
    "WEIGHTS_UNAVAILABLE": "The pretrained weight file could not be resolved or verified.",
    "CHECKPOINT_FAILED": "A checkpoint or run file could not be written.",
    "OUTPUT_EXISTS": "The run directory already exists.",
    "OUTPUT_PARENT_MISSING": "The parent directory of the run directory does not exist.",
}


class TrainingError(Exception):
    def __init__(self, code: str, detail: str | None = None) -> None:
        if code not in MESSAGES:
            raise ValueError("unknown training error code")
        super().__init__(MESSAGES[code] + (f" ({detail})" if detail else ""))
        self.code = code
        self.detail = detail
