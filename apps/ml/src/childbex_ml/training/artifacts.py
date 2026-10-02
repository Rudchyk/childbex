"""Training run directory.

    training-config.json   canonical resolved config (SHA-256 = trainingConfigSha256)
    runtime.json           actual runtime / devices / determinism (never hashed)
    provenance.json        artifact, config, recipe, weights, code provenance
    history.json           per phase and epoch: aggregate TRAIN / VALIDATION metrics
    checkpoints/head.best.weights.h5, checkpoints/finetune.best.weights.h5
    model/model.keras      inference model (adapter + backbone + head), best FINE_TUNE weights
    summary.json           best epochs / metrics, TRAIN / VALIDATION counts
    RUN_COMPLETE.json      written last: SHA-256 of every other file

The run is built in a hidden temporary sibling directory and renamed into
place only after RUN_COMPLETE.json is written, so an interrupted run never
looks complete. Nothing in a run names a sample, patient, path or TEST.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import tempfile
from pathlib import Path

from .errors import TrainingError

RUN_SCHEMA_VERSION = 1
CHECKPOINT_DIR = "checkpoints"
MODEL_FILE = "model/model.keras"
HEAD_CHECKPOINT = "checkpoints/head.best.weights.h5"
FINE_TUNE_CHECKPOINT = "checkpoints/finetune.best.weights.h5"
MARKER = "RUN_COMPLETE.json"


def clean_number(value):
    value = float(value)
    return value if math.isfinite(value) else None


def check_output(output: Path) -> None:
    if output.exists() or output.is_symlink():
        raise TrainingError("OUTPUT_EXISTS")
    if not output.parent.is_dir():
        raise TrainingError("OUTPUT_PARENT_MISSING")


class RunDirectory:
    def __init__(self, output: Path):
        self.output = output
        self.temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.partial-", dir=output.parent))
        (self.temp / CHECKPOINT_DIR).mkdir()
        (self.temp / "model").mkdir()

    def path(self, relative: str) -> Path:
        return self.temp / relative

    def write_json(self, relative: str, value, *, text: str | None = None) -> None:
        try:
            with open(self.temp / relative, "x", encoding="utf-8", newline="\n") as stream:
                stream.write(text if text is not None else json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")
        except OSError:
            raise TrainingError("CHECKPOINT_FAILED", relative) from None

    def complete(self, summary: dict) -> None:
        files = sorted(
            str(p.relative_to(self.temp)).replace("\\", "/") for p in self.temp.rglob("*") if p.is_file()
        )
        hashes = {}
        for name in files:
            digest = hashlib.sha256()
            with open(self.temp / name, "rb") as stream:
                for chunk in iter(lambda: stream.read(1 << 20), b""):
                    digest.update(chunk)
            hashes[name] = digest.hexdigest()
        self.write_json(
            MARKER,
            {
                "runSchemaVersion": RUN_SCHEMA_VERSION,
                "trainingConfigSha256": summary["trainingConfigSha256"],
                "artifactSha256": summary["artifactSha256"],
                "files": hashes,
            },
        )
        if self.output.exists():
            raise TrainingError("OUTPUT_EXISTS")
        try:
            os.rename(self.temp, self.output)
        except OSError:
            raise TrainingError("CHECKPOINT_FAILED", "rename") from None

    def abort(self) -> None:
        shutil.rmtree(self.temp, ignore_errors=True)
