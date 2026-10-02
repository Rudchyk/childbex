"""TRAIN-only augmentation policies.

CT2D_AFFINE_V1: rotation +/- rotationDegrees, translation +/- translationFraction,
zoom +/- zoomFraction; bilinear; constant fill 0.0 (the PR9 "below window /
no data" value). One spatial transform per image, applied identically to the
three CT window channels. No flips, no brightness / contrast / hue /
saturation, no channel permutation. Lives only in the training wrapper,
never in model.keras.
"""

from __future__ import annotations


def build_augmentation(augmentation: dict, seed: int):
    """A keras.Sequential (active only with training=True) or None."""
    if augmentation["policy"] == "NONE":
        return None
    import keras
    from keras import layers

    common = {"fill_mode": "constant", "fill_value": 0.0, "interpolation": "bilinear"}
    zoom = augmentation["zoomFraction"]
    shift = augmentation["translationFraction"]
    return keras.Sequential(
        [
            layers.RandomRotation(augmentation["rotationDegrees"] / 360.0, seed=seed, name="aug_rotation", **common),
            layers.RandomTranslation((-shift, shift), (-shift, shift), seed=seed + 1, name="aug_translation", **common),
            layers.RandomZoom((-zoom, zoom), (-zoom, zoom), seed=seed + 2, name="aug_zoom", **common),
        ],
        name="train_augmentation",
    )


def build_training_model(inference_model, augmentation: dict, seed: int):
    """Wrapper used for fitting: augmentation (TRAIN only) -> inference model.
    Without augmentation the inference model itself is trained."""
    augmenter = build_augmentation(augmentation, seed)
    if augmenter is None:
        return inference_model
    import keras

    inputs = keras.Input(shape=(224, 224, 3), dtype="float32", name="pr9_tensor")
    return keras.Model(inputs, inference_model(augmenter(inputs)), name="training_wrapper")
