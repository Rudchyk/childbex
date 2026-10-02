"""EfficientNetV2B0 model contract (real B0, 224x224x3, weights=None)."""

import hashlib

import numpy as np
import pytest

tf = pytest.importorskip("tensorflow")
keras = pytest.importorskip("keras")
from keras import layers  # noqa: E402

from childbex_ml.training import TrainingError  # noqa: E402
from childbex_ml.training.model import (  # noqa: E402
    ADAPTER_NAME,
    IMAGENET_MEAN,
    IMAGENET_STD,
    backbone_of,
    binary_logit_metrics,
    build_inference_model,
    compile_model,
    set_phase,
)

# Keras 3.11.3 fine-tuning contract: block6a-h (expand, dwconv2, se_reduce,
# se_expand, project convolutions) + top_conv; never BatchNormalization.
FINE_TUNE_LAYER_COUNT = 41
FINE_TUNE_NAMES_SHA256 = "c3b6c89a9e3404735866a7a3a1a774b873df22970bc434239f3b55a5be11dcc3"


@pytest.fixture(scope="module")
def model():
    return build_inference_model("0.2", None)


def all_layers(model):
    return list(model.layers) + list(backbone_of(model).layers)


def test_real_b0_structure_224(model):
    assert tuple(model.input_shape) == (None, 224, 224, 3)
    assert tuple(model.output_shape) == (None, 1)
    assert model.layers[1].name == ADAPTER_NAME and isinstance(model.layers[1], layers.Normalization)
    assert backbone_of(model).name == "efficientnetv2-b0"
    assert model.get_layer("logit").activation.__name__ == "linear"  # raw logit
    assert model.get_layer("head_dropout").rate == pytest.approx(0.2)


def test_exactly_one_input_normalization_and_no_rescaling(model):
    every = all_layers(model)
    assert [l.name for l in every if isinstance(l, layers.Normalization)] == [ADAPTER_NAME]
    assert not [l for l in every if isinstance(l, layers.Rescaling)]  # no x255 / 1/255 anywhere


def test_adapter_known_values(model):
    adapter = model.get_layer(ADAPTER_NAME)
    x = np.array([[[[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], list(IMAGENET_MEAN), [0.5, 0.5, 0.5]]]], np.float32)
    y = adapter(x).numpy()[0, 0]
    expected = (x[0, 0] - np.array(IMAGENET_MEAN, np.float32)) / np.array(IMAGENET_STD, np.float32)
    np.testing.assert_allclose(y, expected, rtol=0, atol=1e-6)
    np.testing.assert_allclose(y[0], [-2.1179039, -2.0357143, -1.8044444], atol=1e-6)
    np.testing.assert_allclose(y[1], [2.2489083, 2.4285715, 2.64], atol=1e-6)
    np.testing.assert_allclose(y[2], [0.0, 0.0, 0.0], atol=1e-6)
    assert y.dtype == np.float32


def test_adapter_equals_keras_3_11_3_builtin_b0_preprocessing(model):
    builtin = keras.applications.EfficientNetV2B0(include_top=False, weights=None, input_shape=(224, 224, 3), include_preprocessing=True, pooling="avg")
    first = [type(l).__name__ for l in builtin.layers[1:3]]
    assert first == ["Rescaling", "Normalization"]  # Keras 3.11.3 B-variant source behaviour
    backbone_of(model).set_weights(builtin.get_weights())
    x = np.random.default_rng(0).random((2, 224, 224, 3), dtype=np.float32)
    reference = builtin(x * 255.0, training=False).numpy()
    ours = backbone_of(model)(model.get_layer(ADAPTER_NAME)(x), training=False).numpy()
    np.testing.assert_allclose(ours, reference, rtol=0, atol=1e-5)
    double = backbone_of(model)(model.get_layer(ADAPTER_NAME)(x * 255.0), training=False).numpy()
    assert np.abs(double - reference).max() > 1e-2  # feeding x255 would be wrong (double scaling)


def trainable_backbone_layers(model):
    return sorted(l.name for l in backbone_of(model).layers if l.trainable and l.weights)


def test_phase_trainable_sets_are_exact(model):
    selected = set_phase(model, "HEAD")
    assert selected == [] and trainable_backbone_layers(model) == []
    assert sorted(w.path for w in model.trainable_weights) == ["logit/bias", "logit/kernel"]

    selected = set_phase(model, "FINE_TUNE")
    names = trainable_backbone_layers(model)
    assert names == sorted(selected)
    assert len(names) == FINE_TUNE_LAYER_COUNT
    assert hashlib.sha256("\n".join(sorted(names)).encode()).hexdigest() == FINE_TUNE_NAMES_SHA256
    assert all(n.startswith("block6") or n == "top_conv" for n in names)
    assert {n.split("_")[0] for n in names} == {f"block6{c}" for c in "abcdefgh"} | {"top"}
    assert not any(isinstance(l, layers.BatchNormalization) and l.trainable for l in backbone_of(model).layers)
    assert len(model.trainable_weights) == 59
    assert sum(int(w.numpy().size) for w in model.trainable_weights) == 4447405
    set_phase(model, "HEAD")


def test_structure_change_fails_instead_of_fine_tuning_something_else():
    from childbex_ml.training.model import EFFICIENTNETV2B0, BackboneSpec

    wrong = BackboneSpec(build=EFFICIENTNETV2B0.build, fine_tune_blocks=frozenset({"block7a"}))
    candidate = build_inference_model("0.2", None, wrong)
    with pytest.raises(TrainingError) as error:
        set_phase(candidate, "FINE_TUNE", wrong)
    assert error.value.code == "MODEL_STRUCTURE_MISMATCH"


def test_batchnorm_statistics_unchanged_during_fine_tuning():
    keras.utils.set_random_seed(5)
    model = build_inference_model("0.2", None)
    set_phase(model, "FINE_TUNE")
    compile_model(model, "0.001")
    base = backbone_of(model)
    bn = [l for l in base.layers if isinstance(l, layers.BatchNormalization)]
    before_bn = [[v.numpy().copy() for v in l.weights] for l in bn]
    stem_before = base.get_layer("stem_conv").kernel.numpy().copy()
    block6_before = base.get_layer("block6h_project_conv").kernel.numpy().copy()
    x = np.random.default_rng(1).random((4, 224, 224, 3), dtype=np.float32)
    model.fit(x, np.array([0, 1, 0, 1], np.float32), batch_size=2, epochs=1, verbose=0, shuffle=False)
    assert len(bn) == 59
    for layer, before in zip(bn, before_bn):
        for value, old in zip(layer.weights, before):
            assert np.array_equal(value.numpy(), old), layer.name  # moving mean/variance, gamma, beta
    assert np.array_equal(base.get_layer("stem_conv").kernel.numpy(), stem_before)  # frozen
    assert not np.array_equal(base.get_layer("block6h_project_conv").kernel.numpy(), block6_before)  # trained


def test_logit_metric_thresholds_are_zero():
    y_true = np.array([1, 1, 0, 0], np.float32)
    logits = np.array([0.1, -0.1, 0.2, -0.2], np.float32)  # probabilities 0.525, 0.475, 0.55, 0.45
    results = {}
    for metric in binary_logit_metrics():
        metric.update_state(y_true, logits)
        results[metric.name] = float(metric.result())
    assert results["accuracy"] == 0.5 and results["precision"] == 0.5 and results["recall"] == 0.5
    wrong = keras.metrics.Recall()  # default threshold 0.5 applied to raw logits
    wrong.update_state(y_true, logits)
    assert float(wrong.result()) == 0.0
    probabilities = keras.metrics.Recall(thresholds=0.5)
    probabilities.update_state(y_true, tf.sigmoid(logits))
    assert float(probabilities.result()) == results["recall"]
    assert results["roc_auc"] == pytest.approx(0.5) and 0 <= results["pr_auc"] <= 1
    loss = keras.losses.BinaryCrossentropy(from_logits=True)(y_true, logits).numpy()
    manual = np.mean(np.maximum(logits, 0) - logits * y_true + np.log1p(np.exp(-np.abs(logits))))
    assert float(loss) == pytest.approx(float(manual), abs=1e-6)


def test_model_keras_round_trip(tmp_path, model):
    path = tmp_path / "model.keras"
    model.save(path)
    loaded = keras.saving.load_model(path)
    x = np.random.default_rng(2).random((1, 224, 224, 3), dtype=np.float32)
    assert np.array_equal(model(x, training=False).numpy(), loaded(x, training=False).numpy())
    assert loaded.layers[1].name == ADAPTER_NAME
    assert not [l for l in all_layers(loaded) if l.name.startswith(("aug_", "random"))]
