"""EFFICIENTNETV2B0_BINARY_LOGIT_V1 and its explicit input adapter.

    PR9 tensor (224x224x3 float32, [0,1])
      -> EFFICIENTNETV2_IMAGENET_INPUT_V1: y_c = (x_c - mean_c) / std_c
      -> EfficientNetV2B0(include_top=False, include_preprocessing=False, pooling="avg"),
         called with training=False (BatchNorm always uses its moving statistics)
      -> Dropout(0.2) -> Dense(1): one raw logit

Keras 3.11.3 source (efficientnet_v2.py): for the B variants with 3 channels,
the built-in preprocessing is Rescaling(1/255) followed by Normalization with
the ImageNet mean / variance below, i.e. inputs in [0, 255]. The generic
docstring's "[-1, 1] without preprocessing" only holds for S/M/L. ChildBEx
disables the built-in layers and applies the same normalization explicitly
to [0,1] inputs (no x255 step); a regression test pins the equivalence.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal

from .errors import TrainingError

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
ADAPTER_NAME = "efficientnetv2_imagenet_input_v1"
BACKBONE_NAME = "efficientnetv2-b0"  # Keras selects the B0 block arguments by this name
LOGIT_NAME = "logit"


def build_input_adapter():
    """EFFICIENTNETV2_IMAGENET_INPUT_V1 as a built-in, serializable layer."""
    from keras import layers

    return layers.Normalization(
        mean=list(IMAGENET_MEAN), variance=[s * s for s in IMAGENET_STD], name=ADAPTER_NAME
    )


@dataclass(frozen=True)
class BackboneSpec:
    """How to build the backbone and which layers phase FINE_TUNE trains."""

    build: Callable[[str | None], object]  # weights path or None -> keras.Model (pooled features)
    fine_tune_blocks: frozenset[str]  # block prefixes, e.g. {"block6a", ..., "block6h"}
    fine_tune_extra: frozenset[str] = field(default_factory=lambda: frozenset({"top_conv"}))


def _efficientnetv2b0(weights_path: str | None):
    import keras

    return keras.applications.EfficientNetV2B0(
        include_top=False,
        weights=weights_path,
        input_shape=(224, 224, 3),
        include_preprocessing=False,
        pooling="avg",
        name=BACKBONE_NAME,
    )


EFFICIENTNETV2B0 = BackboneSpec(
    build=_efficientnetv2b0,
    fine_tune_blocks=frozenset(f"block6{c}" for c in "abcdefgh"),
)


def build_inference_model(dropout: str, weights_path: str | None, backbone: BackboneSpec = EFFICIENTNETV2B0):
    """The model saved as model.keras: adapter -> backbone -> dropout -> logit."""
    import keras
    from keras import layers

    inputs = keras.Input(shape=(224, 224, 3), dtype="float32", name="pr9_tensor")
    base = backbone.build(weights_path)
    if tuple(base.input_shape[1:]) != (224, 224, 3):
        raise TrainingError("MODEL_INPUT_MISMATCH")
    features = base(build_input_adapter()(inputs), training=False)
    features = layers.Dropout(float(Decimal(dropout)), name="head_dropout")(features)
    logit = layers.Dense(1, name=LOGIT_NAME)(features)
    return keras.Model(inputs, logit, name="childbex_efficientnetv2b0_binary_logit_v1")


def backbone_of(model):
    return model.get_layer(BACKBONE_NAME)


def fine_tune_layer_names(base, backbone: BackboneSpec) -> list[str]:
    """Layers trained in FINE_TUNE: block6* and top_conv, never BatchNorm.
    Raises MODEL_STRUCTURE_MISMATCH if the expected structure is absent."""
    from keras import layers

    names = [layer.name for layer in base.layers]
    blocks = {name.split("_")[0] for name in names if name.startswith("block")}
    if not backbone.fine_tune_blocks <= blocks or not all(extra in names for extra in backbone.fine_tune_extra):
        raise TrainingError("MODEL_STRUCTURE_MISMATCH")
    selected = []
    for layer in base.layers:
        in_scope = layer.name.split("_")[0] in backbone.fine_tune_blocks or layer.name in backbone.fine_tune_extra
        if in_scope and not isinstance(layer, layers.BatchNormalization) and layer.weights:
            selected.append(layer.name)
    if not selected:
        raise TrainingError("MODEL_STRUCTURE_MISMATCH")
    return selected


def set_phase(model, phase: str, backbone: BackboneSpec = EFFICIENTNETV2B0) -> list[str]:
    """HEAD: backbone frozen. FINE_TUNE: only the contract layers trainable,
    every BatchNormalization frozen. Returns the trainable backbone layers."""
    from keras import layers

    base = backbone_of(model)
    if phase == "HEAD":
        base.trainable = False
        selected: list[str] = []
    elif phase == "FINE_TUNE":
        selected = fine_tune_layer_names(base, backbone)
        base.trainable = True
        chosen = set(selected)
        for layer in base.layers:
            layer.trainable = layer.name in chosen
            if isinstance(layer, layers.BatchNormalization):
                layer.trainable = False
    else:
        raise ValueError("unknown phase")
    for name in ("head_dropout", LOGIT_NAME):
        model.get_layer(name).trainable = True
    return selected


def compile_model(model, learning_rate: str) -> None:
    """Adam; BCE on logits; BINARY_LOGIT_METRICS_V1 (thresholds at logit 0 =
    probability 0.5); no XLA."""
    import keras

    from .config import parse_decimal

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=parse_decimal(learning_rate, "learningRate")),
        loss=keras.losses.BinaryCrossentropy(from_logits=True, name="loss"),
        metrics=binary_logit_metrics(),
        jit_compile=False,
    )


def binary_logit_metrics() -> list:
    import keras

    return [
        keras.metrics.AUC(curve="ROC", from_logits=True, name="roc_auc"),
        keras.metrics.AUC(curve="PR", from_logits=True, name="pr_auc"),
        keras.metrics.BinaryAccuracy(threshold=0.0, name="accuracy"),
        keras.metrics.Precision(thresholds=0.0, name="precision"),
        keras.metrics.Recall(thresholds=0.0, name="recall"),
    ]
