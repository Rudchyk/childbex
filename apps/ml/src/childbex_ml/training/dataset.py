"""TRAIN / VALIDATION input pipeline over a verified cloud artifact.

The PR10.5 reader stays the only parser and integrity authority: tensors are
read lazily (validated memory-mapped shards, SHA-256 per tensor) through
`CloudArtifact.iter_samples`. Nothing is skipped; a hash failure aborts.

TRAIN order (EPOCH_SHA256_ORDER_V1) is owned by this module, not by Keras:
for (seed, phase, epoch) the TRAIN sample positions are sorted by
SHA-256("childbex-train-order:v1:<seed>:<phase>:<epoch>:<sampleToken>").
Each epoch's dataset is built explicitly for that epoch; phases are separate
namespaces. VALIDATION always uses the canonical manifest order. TEST is
never iterated.
"""

from __future__ import annotations

import hashlib

from .errors import TrainingError

ALLOWED_SPLITS = ("TRAIN", "VALIDATION")


def _check_split(split: str) -> str:
    if split not in ALLOWED_SPLITS:
        raise TrainingError("TEST_ACCESS_FORBIDDEN" if split == "TEST" else "INVALID_TRAINING_CONFIG", "split")
    return split


def train_order(sample_tokens: list[str], seed: int, phase: str, epoch: int) -> list[int]:
    """EPOCH_SHA256_ORDER_V1: a deterministic permutation of positions."""
    def key(position: int) -> str:
        text = f"childbex-train-order:v1:{seed}:{phase}:{epoch}:{sample_tokens[position]}"
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    return sorted(range(len(sample_tokens)), key=key)


def split_tokens(artifact, split: str) -> list[str]:
    return [sample["sampleToken"] for sample in artifact.split_samples(_check_split(split))]


def split_label_counts(artifact, split: str) -> dict:
    counts = artifact.manifest["counts"][_check_split(split)]
    return {"samples": counts["samples"], "NORMAL": counts["NORMAL"], "ABNORMAL": counts["ABNORMAL"]}


def epoch_positions(artifact, split: str, *, seed: int | None = None, phase: str | None = None, epoch: int | None = None) -> list[int]:
    split = _check_split(split)
    tokens = split_tokens(artifact, split)
    if split == "VALIDATION":
        return list(range(len(tokens)))
    return train_order(tokens, seed, phase, epoch)


def make_dataset(artifact, split: str, positions: list[int], batch_size: int):
    """A finite tf.data.Dataset of (tensor, label) batches in exactly this order."""
    import tensorflow as tf

    split = _check_split(split)
    height, width, channels = artifact.manifest["tensor"]["shape"]

    def generate():
        for sample in artifact.iter_samples(split, positions):
            yield sample.tensor, float(sample.label_index)

    signature = (
        tf.TensorSpec(shape=(height, width, channels), dtype=tf.float32),
        tf.TensorSpec(shape=(), dtype=tf.float32),
    )
    return tf.data.Dataset.from_generator(generate, output_signature=signature).batch(batch_size).prefetch(tf.data.AUTOTUNE)


def class_weights(policy: str, train_counts: dict) -> dict | None:
    """TRAIN_BALANCED_V1: w_c = n_train / (2 * n_c), from TRAIN counts only."""
    if policy == "NONE":
        return None
    total = train_counts["NORMAL"] + train_counts["ABNORMAL"]
    return {
        0: total / (2 * train_counts["NORMAL"]),
        1: total / (2 * train_counts["ABNORMAL"]),
    }
