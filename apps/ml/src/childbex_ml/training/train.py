"""PR11 training orchestration: one call = one explicit training configuration.

Order of operations (everything that can be checked is checked before any
model is fitted):

 1. TRAINING_RUNTIME_V1 (UNSUPPORTED_RUNTIME)
 2. training recipe (INVALID_TRAINING_CONFIG)
 3. output directory
 4. cloud artifact: full PR10.5 verification (ARTIFACT_INVALID), schema,
    tensor contract 224x224x3 float32 little-endian HWC, preprocessing
    contract, configured artifact binding (ARTIFACT_MISMATCH)
 5. TRAIN / VALIDATION non-empty with both classes (TEST is never read)
 6. determinism (strict by default: DETERMINISM_UNAVAILABLE)
 7. pretrained weights (resolved, checksummed)
 8. HEAD phase, then FINE_TUNE from the best HEAD checkpoint; per epoch an
    explicit TRAIN order, one fit epoch, one VALIDATION evaluation; the
    checkpoint follows val_pr_auc (max) with early-stopping patience
 9. model.keras (best FINE_TUNE weights), records, RUN_COMPLETE.json, rename
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .. import __version__
from ..canonical import canonical_json
from ..cloud_artifact import CloudArtifact, CloudArtifactError
from .artifacts import FINE_TUNE_CHECKPOINT, HEAD_CHECKPOINT, MODEL_FILE, RunDirectory, check_output, clean_number
from .config import (
    INPUT_ADAPTER,
    LABEL_ENCODING,
    resolve_config,
    training_config_sha256,
    training_recipe_sha256,
    validate_recipe,
)
from .dataset import class_weights, epoch_positions, make_dataset, split_label_counts
from .errors import TrainingError
from .model import EFFICIENTNETV2B0, BackboneSpec, build_inference_model, compile_model, set_phase
from .runtime import RUNTIME_PROFILE, check_runtime, describe_runtime
from .weights import Fetcher, resolve_weights

SUPPORTED_PREPROCESSING_MODES = ("MULTI_WINDOW_3CH", "SINGLE_WINDOW_3CH")


def open_artifact(root) -> CloudArtifact:
    try:
        return CloudArtifact.open(root)
    except CloudArtifactError as error:
        raise TrainingError("ARTIFACT_INVALID", error.code) from None


def artifact_binding(artifact: CloudArtifact) -> dict:
    """Validates the artifact against the PR11 production contract."""
    manifest = artifact.manifest
    if manifest["artifactSchemaVersion"] != 1 or manifest["kind"] != "CHILDBEX_CT_SLICE_TENSORS_V1":
        raise TrainingError("UNSUPPORTED_ARTIFACT_SCHEMA")
    if manifest["tensor"] != {"shape": [224, 224, 3], "dtype": "float32", "byteOrder": "little", "layout": "HWC"}:
        raise TrainingError("INCOMPATIBLE_TENSOR_CONTRACT")
    preprocessing = manifest["preprocessing"]
    config = preprocessing["config"]
    if (
        preprocessing["schemaVersion"] != 1
        or config.get("schemaVersion") != 1
        or config.get("mode") not in SUPPORTED_PREPROCESSING_MODES
        or config.get("output") != {"channels": 3, "dtype": "float32", "range": [0.0, 1.0]}
    ):
        raise TrainingError("UNSUPPORTED_PREPROCESSING_CONFIG")
    if manifest["labelEncoding"] != LABEL_ENCODING:
        raise TrainingError("UNSUPPORTED_ARTIFACT_SCHEMA", "labelEncoding")
    return {
        "artifactSha256": artifact.artifact_sha256,
        "kind": manifest["kind"],
        "artifactSchemaVersion": manifest["artifactSchemaVersion"],
        "manifestSha256": manifest["source"]["manifestSha256"],
        "preflightIdentity": manifest["source"]["preflightIdentity"],
        "preprocessingConfigHash": preprocessing["configHash"],
    }


def check_splits(artifact: CloudArtifact) -> dict:
    counts = {split: split_label_counts(artifact, split) for split in ("TRAIN", "VALIDATION")}
    if counts["TRAIN"]["samples"] == 0:
        raise TrainingError("NO_TRAIN_SAMPLES")
    if counts["VALIDATION"]["samples"] == 0:
        raise TrainingError("NO_VALIDATION_SAMPLES")
    if not (counts["TRAIN"]["NORMAL"] and counts["TRAIN"]["ABNORMAL"]):
        raise TrainingError("TRAIN_CLASS_MISSING")
    if not (counts["VALIDATION"]["NORMAL"] and counts["VALIDATION"]["ABNORMAL"]):
        raise TrainingError("VALIDATION_CLASS_MISSING")
    return counts


def configure_determinism(policy: str, seed: int) -> dict:
    import keras
    import tensorflow as tf

    keras.utils.set_random_seed(seed)
    if policy == "STRICT":
        try:
            tf.config.experimental.enable_op_determinism()
        except Exception:
            raise TrainingError("DETERMINISM_UNAVAILABLE") from None
        return {"policy": "STRICT", "opDeterminism": True, "jitCompile": False, "mixedPrecision": False, "seed": seed}
    return {
        "policy": "BEST_EFFORT",
        "opDeterminism": False,
        "jitCompile": False,
        "mixedPrecision": False,
        "seed": seed,
        "warning": "BEST_EFFORT: execution is not guaranteed to be deterministic",
    }


def git_commit() -> str | None:
    value = os.environ.get("CHILDBEX_GIT_COMMIT")
    if value:
        return value
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, capture_output=True, text=True, timeout=10
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def _is_determinism_error(error: Exception) -> bool:
    return "determinis" in str(error).lower()


def train(
    artifact_root,
    config: dict,
    output,
    *,
    backbone: BackboneSpec = EFFICIENTNETV2B0,
    weights_fetch: Fetcher | None = None,
    verbose: int = 0,
) -> dict:
    check_runtime()
    validate_recipe(config)
    output = Path(output).resolve()
    check_output(output)

    artifact = open_artifact(artifact_root)
    binding = artifact_binding(artifact)
    resolved = resolve_config(config, binding)
    config_sha, recipe_sha = training_config_sha256(resolved), training_recipe_sha256(resolved)
    counts = check_splits(artifact)
    weights_for_classes = class_weights(resolved["classWeighting"], counts["TRAIN"])

    determinism = configure_determinism(resolved["determinism"], resolved["seeds"]["global"])
    if resolved["model"]["weights"] == "NONE":
        weights_path, weights_provenance = None, {"weightSpec": "NONE"}
    else:
        path, weights_provenance = resolve_weights(resolved["model"]["weights"], weights_fetch)
        weights_path = str(path)

    import tensorflow as tf

    from .augmentation import build_training_model

    inference = build_inference_model(resolved["model"]["dropout"], weights_path, backbone)
    if tuple(inference.input_shape[1:]) != tuple(artifact.manifest["tensor"]["shape"]) or tuple(inference.output_shape[1:]) != (1,):
        raise TrainingError("MODEL_INPUT_MISMATCH")
    training_model = build_training_model(inference, resolved["augmentation"], resolved["seeds"]["augmentation"])

    run = RunDirectory(output)
    try:
        batch_size = resolved["data"]["batchSize"]
        validation_positions = epoch_positions(artifact, "VALIDATION")
        history, phase_summaries = [], {}
        checkpoints = {"HEAD": HEAD_CHECKPOINT, "FINE_TUNE": FINE_TUNE_CHECKPOINT}
        for phase in resolved["phases"]:
            name = phase["name"]
            if name == "FINE_TUNE":
                inference.load_weights(run.path(HEAD_CHECKPOINT))
            trainable_layers = set_phase(inference, name, backbone)
            compile_model(training_model, phase["optimizer"]["learningRate"])
            best, best_epoch, wait, epochs_run = None, None, 0, 0
            for epoch in range(phase["maxEpochs"]):
                positions = epoch_positions(artifact, "TRAIN", seed=resolved["seeds"]["trainOrder"], phase=name, epoch=epoch)
                try:
                    fitted = training_model.fit(
                        make_dataset(artifact, "TRAIN", positions, batch_size),
                        epochs=1,
                        verbose=verbose,
                        class_weight=weights_for_classes,
                    )
                    validation = training_model.evaluate(
                        make_dataset(artifact, "VALIDATION", validation_positions, batch_size), verbose=0, return_dict=True
                    )
                except tf.errors.OpError as error:
                    if resolved["determinism"] == "STRICT" and _is_determinism_error(error):
                        raise TrainingError("DETERMINISM_UNAVAILABLE") from None
                    raise
                epochs_run += 1
                record = {
                    "phase": name,
                    "epoch": epoch,
                    "train": {key: clean_number(values[-1]) for key, values in sorted(fitted.history.items())},
                    "validation": {f"val_{key}": clean_number(value) for key, value in sorted(validation.items())},
                }
                history.append(record)
                monitor = record["validation"]["val_pr_auc"]
                if monitor is not None and (best is None or monitor > best):
                    best, best_epoch, wait = monitor, epoch, 0
                    try:
                        inference.save_weights(run.path(checkpoints[name]))
                    except OSError:
                        raise TrainingError("CHECKPOINT_FAILED", checkpoints[name]) from None
                else:
                    wait += 1
                    if wait >= phase["earlyStoppingPatience"]:
                        break
            if best_epoch is None:
                raise TrainingError("CHECKPOINT_FAILED", f"no finite val_pr_auc in {name}")
            phase_summaries[name] = {
                "epochsRun": epochs_run,
                "bestEpoch": best_epoch,
                "best": next(r["validation"] for r in history if r["phase"] == name and r["epoch"] == best_epoch),
                "trainableBackboneLayers": len(trainable_layers),
                "trainableWeights": sum(int(w.numpy().size) for w in inference.trainable_weights),
                "totalWeights": sum(int(w.numpy().size) for w in inference.weights),
            }

        inference.load_weights(run.path(FINE_TUNE_CHECKPOINT))
        try:
            inference.save(run.path(MODEL_FILE))
        except OSError:
            raise TrainingError("CHECKPOINT_FAILED", MODEL_FILE) from None

        summary = {
            "trainingConfigSha256": config_sha,
            "trainingRecipeSha256": recipe_sha,
            "artifactSha256": binding["artifactSha256"],
            "counts": counts,
            "classWeights": None if weights_for_classes is None else {str(k): v for k, v in weights_for_classes.items()},
            "phases": phase_summaries,
            "finalModel": {"file": MODEL_FILE, "from": "FINE_TUNE best val_pr_auc", "checkpoint": FINE_TUNE_CHECKPOINT},
        }
        provenance = {
            "trainingConfigSha256": config_sha,
            "trainingRecipeSha256": recipe_sha,
            **binding,
            "runtimeProfile": RUNTIME_PROFILE,
            "modelArchitecture": resolved["model"]["architecture"],
            "inputAdapter": INPUT_ADAPTER,
            "weights": weights_provenance,
            "labelEncoding": resolved["labelEncoding"],
            "seeds": resolved["seeds"],
            "trainOrder": resolved["data"]["trainOrder"],
            "augmentation": resolved["augmentation"],
            "classWeighting": resolved["classWeighting"],
            "determinism": determinism,
            "childbexMlVersion": __version__,
            "gitCommit": git_commit(),
        }
        runtime = {**describe_runtime(), "determinism": determinism}
        run.write_json("training-config.json", None, text=canonical_json(resolved))
        run.write_json("runtime.json", runtime)
        run.write_json("provenance.json", provenance)
        run.write_json("history.json", {"epochs": history})
        run.write_json("summary.json", summary)
        run.complete(summary)
        return summary
    except BaseException:
        run.abort()
        raise
