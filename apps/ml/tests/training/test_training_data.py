"""Explicit epoch ordering, TRAIN / VALIDATION datasets, TEST isolation,
class weights and augmentation."""

import numpy as np
import pytest

from childbex_ml.cloud_artifact import CloudArtifact
from childbex_ml.training import TrainingError
from childbex_ml.training.dataset import class_weights, epoch_positions, split_label_counts, split_tokens, train_order
from training_helpers import make_artifact


@pytest.fixture(scope="module")
def artifact(tmp_path_factory):
    return CloudArtifact.open(make_artifact(tmp_path_factory.mktemp("data"))["root"])


TOKENS = [f"s{n:06d}" for n in range(1, 41)]


def test_epoch_orders_are_deterministic_and_differ_per_epoch():
    orders = [train_order(TOKENS, 7, "HEAD", epoch) for epoch in range(3)]
    assert orders == [train_order(TOKENS, 7, "HEAD", epoch) for epoch in range(3)]  # same seed repeats exactly
    assert len({tuple(o) for o in orders}) == 3  # epochs 0, 1, 2 differ
    for order in orders:
        assert sorted(order) == list(range(len(TOKENS)))  # a permutation: every sample exactly once
    assert orders[0] != list(range(len(TOKENS)))


def test_seed_and_phase_are_separate_namespaces():
    head = [train_order(TOKENS, 7, "HEAD", e) for e in range(3)]
    other_seed = [train_order(TOKENS, 8, "HEAD", e) for e in range(3)]
    fine_tune = [train_order(TOKENS, 7, "FINE_TUNE", e) for e in range(3)]
    assert all(a != b for a, b in zip(head, other_seed))
    assert all(a != b for a, b in zip(head, fine_tune))
    assert not set(map(tuple, head)) & set(map(tuple, fine_tune))


def test_train_order_is_defined_by_sha256_of_tokens():
    import hashlib

    expected = sorted(range(len(TOKENS)), key=lambda i: hashlib.sha256(f"childbex-train-order:v1:7:HEAD:1:{TOKENS[i]}".encode()).hexdigest())
    assert train_order(TOKENS, 7, "HEAD", 1) == expected


def test_validation_is_canonical_and_test_is_forbidden(artifact):
    assert epoch_positions(artifact, "VALIDATION") == list(range(artifact.count("VALIDATION")))
    for split in ("TEST",):
        for fn in (lambda: epoch_positions(artifact, split), lambda: split_tokens(artifact, split), lambda: split_label_counts(artifact, split)):
            with pytest.raises(TrainingError) as error:
                fn()
            assert error.value.code == "TEST_ACCESS_FORBIDDEN"


def test_class_weights_from_train_only(artifact):
    train = split_label_counts(artifact, "TRAIN")
    assert train == {"samples": 7, "NORMAL": 4, "ABNORMAL": 3}
    assert class_weights("NONE", train) is None
    assert class_weights("TRAIN_BALANCED_V1", train) == {0: 7 / 8, 1: 7 / 6}
    assert split_label_counts(artifact, "VALIDATION") == {"samples": 3, "NORMAL": 1, "ABNORMAL": 2}


# --- tf.data bridge -----------------------------------------------------------------


def test_dataset_yields_every_sample_once_in_the_given_order(artifact):
    pytest.importorskip("tensorflow")
    from childbex_ml.training.dataset import make_dataset

    for epoch in range(3):
        positions = epoch_positions(artifact, "TRAIN", seed=11, phase="HEAD", epoch=epoch)
        batches = list(make_dataset(artifact, "TRAIN", positions, 3).as_numpy_iterator())
        tensors = np.concatenate([b[0] for b in batches])
        labels = np.concatenate([b[1] for b in batches])
        expected = list(artifact.iter_samples("TRAIN", positions))
        assert [len(b[0]) for b in batches] == [3, 3, 1]
        assert tensors.shape == (7, 224, 224, 3) and tensors.dtype == np.float32
        for got, sample in zip(tensors, expected):
            assert got.tobytes() == sample.tensor.tobytes()
        assert labels.tolist() == [float(s.label_index) for s in expected]


def test_validation_dataset_order_is_fixed(artifact):
    pytest.importorskip("tensorflow")
    from childbex_ml.training.dataset import make_dataset

    canonical = [s.sample_token for s in artifact.iter_split("VALIDATION")]
    reference = [s.tensor.tobytes() for s in artifact.iter_split("VALIDATION")]
    for _ in range(2):
        batches = list(make_dataset(artifact, "VALIDATION", epoch_positions(artifact, "VALIDATION"), 2).as_numpy_iterator())
        got = [t.tobytes() for b in batches for t in b[0]]
        assert got == reference and len(canonical) == 3


def test_dataset_is_lazy(artifact, monkeypatch):
    pytest.importorskip("tensorflow")
    from childbex_ml.training.dataset import make_dataset

    reads = []
    original = artifact.iter_samples

    def counting(split, order=None):
        for sample in original(split, order):
            reads.append(sample.sample_token)
            yield sample

    monkeypatch.setattr(artifact, "iter_samples", counting)
    dataset = make_dataset(artifact, "TRAIN", epoch_positions(artifact, "TRAIN", seed=1, phase="HEAD", epoch=0), 2)
    assert reads == []  # building the dataset reads nothing
    next(iter(dataset))
    assert 0 < len(reads)


# --- augmentation ------------------------------------------------------------------------


@pytest.fixture
def ct2d():
    from childbex_ml.training import load_preset

    return load_preset("efficientnetv2b0-baseline-v1")["augmentation"]


def test_augmentation_policy_layers(ct2d):
    pytest.importorskip("tensorflow")
    from keras import layers

    from childbex_ml.training.augmentation import build_augmentation

    assert build_augmentation({"policy": "NONE"}, 1) is None
    aug = build_augmentation(ct2d, 1)
    kinds = [type(l) for l in aug.layers]
    assert kinds == [layers.RandomRotation, layers.RandomTranslation, layers.RandomZoom]
    rotation, translation, zoom = aug.layers
    assert rotation.factor == (-5 / 360, 5 / 360)
    assert translation.height_factor == (-0.05, 0.05) and translation.width_factor == (-0.05, 0.05)
    assert zoom.height_factor == (-0.05, 0.05) and zoom.width_factor == (-0.05, 0.05)
    for layer in aug.layers:
        assert (layer.fill_mode, layer.fill_value, layer.interpolation) == ("constant", 0.0, "bilinear")
    forbidden = ("RandomFlip", "RandomContrast", "RandomBrightness", "RandomHue", "RandomSaturation", "RandomColor", "ChannelShuffle")
    assert not [l for l in aug.layers if type(l).__name__ in forbidden]


def test_same_spatial_transform_for_all_channels_and_inference_passthrough(ct2d):
    pytest.importorskip("tensorflow")
    from childbex_ml.training.augmentation import build_augmentation

    aug = build_augmentation(ct2d, 3)
    base = np.random.default_rng(4).random((4, 224, 224, 1), dtype=np.float32)
    images = np.concatenate([base, base, base], axis=-1)
    out = aug(images, training=True).numpy()
    assert not np.array_equal(out, images)
    assert np.array_equal(out[..., 0], out[..., 1]) and np.array_equal(out[..., 0], out[..., 2])
    assert out.min() >= 0.0 and out.max() <= 1.0
    distinct = np.stack([base[..., 0], 0.5 * base[..., 0], 0.25 + 0.5 * base[..., 0]], axis=-1)
    assert np.array_equal(aug(distinct, training=False).numpy(), distinct)  # validation / inference: unchanged
