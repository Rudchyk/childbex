"""PIXEL_SPACING_V1 aspect ratio, AREA_V1, CENTER letterbox, orientation,
WINDOW_THEN_RESIZE."""

from fractions import Fraction

import numpy as np
import pytest

from childbex_ml.preprocessing import ContentBox, PreprocessingError, preprocess_dicom_bytes
from childbex_ml.preprocessing.resize import area_resize, area_weights, fit_content, letterbox
from childbex_ml.preprocessing.window import apply_window
from conftest import with_size
from synthetic import ct_bytes


# --- content box ---------------------------------------------------------


@pytest.mark.parametrize(
    ("rows", "columns", "spacing", "box"),
    [
        (512, 512, (0.7, 0.7), ContentBox(0, 0, 224, 224)),
        (512, 640, (0.7, 0.7), ContentBox(22, 0, 179, 224)),  # 179.2 -> 179; 45 spare: 22 top / 23 bottom
        (640, 512, (0.7, 0.7), ContentBox(0, 22, 224, 179)),
        (512, 512, (0.5, 1.0), ContentBox(56, 0, 112, 224)),  # physical 256 x 512 mm
        (512, 512, (1.0, 0.5), ContentBox(0, 56, 224, 112)),
        (256, 512, (1.0, 0.5), ContentBox(0, 0, 224, 224)),  # non-square matrix, square physically
        (100, 100, (0.7, 0.7), ContentBox(0, 0, 224, 224)),  # upscaled
        (1, 4096, (1.0, 1.0), ContentBox(111, 0, 1, 224)),  # never below 1 pixel
    ],
)
def test_content_box_formula(rows, columns, spacing, box):
    assert fit_content(rows, columns, spacing[0], spacing[1], 224, 224) == box


def test_content_box_is_deterministic():
    boxes = {fit_content(333, 517, 0.683594, 0.712891, 224, 224) for _ in range(100)}
    assert len(boxes) == 1


def test_non_square_spacing_changes_content_aspect_ratio(multi):
    stored = np.full((64, 64), 1024 + 40, dtype=np.int16)
    tall = preprocess_dicom_bytes(ct_bytes(stored, pixel_spacing=(1.0, 0.5)), multi)
    wide = preprocess_dicom_bytes(ct_bytes(stored, pixel_spacing=(0.5, 1.0)), multi)
    assert tall.content_box == ContentBox(0, 56, 224, 112)
    assert wide.content_box == ContentBox(56, 0, 112, 224)
    # Physical aspect (height / width) is preserved.
    assert tall.content_box.height / tall.content_box.width == pytest.approx(64 * 1.0 / (64 * 0.5))
    assert wide.content_box.height / wide.content_box.width == pytest.approx(64 * 0.5 / (64 * 1.0))


def test_square_matrix_with_anisotropic_spacing_is_not_stretched_to_square(multi):
    stored = np.full((64, 64), 1024 + 40, dtype=np.int16)  # soft tissue center: 0.5
    result = preprocess_dicom_bytes(ct_bytes(stored, pixel_spacing=(0.5, 1.0)), multi)
    tensor = result.tensor
    assert np.all(tensor[56:168, :, 0] == 0.5)  # content
    assert np.all(tensor[:56] == 0.0) and np.all(tensor[168:] == 0.0)  # letterbox
    isotropic = preprocess_dicom_bytes(ct_bytes(stored, pixel_spacing=(0.7, 0.7)), multi)
    assert isotropic.content_box == ContentBox(0, 0, 224, 224)


def test_invalid_spacing_is_rejected_even_with_valid_matrix(multi):
    with pytest.raises(PreprocessingError) as error:
        preprocess_dicom_bytes(ct_bytes(pixel_spacing=None), multi)
    assert error.value.code == "INVALID_PIXEL_SPACING"


# --- AREA_V1 ---------------------------------------------------------------


def test_area_weights_exact_values():
    assert area_weights(4, 2) == ((0, (0.5, 0.5)), (2, (0.5, 0.5)))
    assert area_weights(3, 2) == ((0, (2 / 3, 1 / 3)), (1, (1 / 3, 2 / 3)))
    assert area_weights(2, 4) == ((0, (1.0,)), (0, (1.0,)), (1, (1.0,)), (1, (1.0,)))
    assert area_weights(5, 5) == tuple((i, (1.0,)) for i in range(5))
    assert area_weights(3, 1) == ((0, (1 / 3, 1 / 3, 1 / 3)),)


def test_area_weights_sum_to_one():
    for n_in, n_out in [(512, 224), (640, 179), (333, 224), (100, 224), (7, 3)]:
        for _, weights in area_weights(n_in, n_out):
            assert sum(Fraction(w) for w in weights) == pytest.approx(1, abs=1e-12)


def _reference_area(image: np.ndarray, height: int, width: int) -> np.ndarray:
    """Independent dense implementation from the written definition."""

    def matrix(n_in, n_out):
        scale = Fraction(n_in, n_out)
        m = np.zeros((n_out, n_in))
        for i in range(n_out):
            start, end = i * scale, (i + 1) * scale
            for j in range(n_in):
                overlap = min(end, Fraction(j + 1)) - max(start, Fraction(j))
                if overlap > 0:
                    m[i, j] = float(overlap / scale)
        return m

    rows, cols = matrix(image.shape[0], height), matrix(image.shape[1], width)
    return np.stack([rows @ image[..., c] @ cols.T for c in range(image.shape[2])], axis=-1)


@pytest.mark.parametrize(("shape", "size"), [((7, 5), (3, 4)), ((64, 80), (23, 29)), ((5, 5), (9, 11))])
def test_area_resize_matches_independent_reference(shape, size):
    rng = np.random.default_rng(1)
    image = rng.random(shape + (3,), dtype=np.float32)
    out = area_resize(image, *size)
    assert out.dtype == np.float32 and out.shape == size + (3,)
    assert np.allclose(out, _reference_area(image.astype(np.float64), *size), rtol=0, atol=1e-6)


def test_area_resize_identity_is_exact():
    image = np.random.default_rng(2).random((6, 9, 3), dtype=np.float32)
    assert np.array_equal(area_resize(image, 6, 9), image)


def test_all_three_channels_get_the_same_spatial_transform():
    base = np.random.default_rng(3).random((50, 70), dtype=np.float32)
    image = np.stack([base, base, base], axis=-1)
    out = area_resize(image, 21, 30)
    assert np.array_equal(out[..., 0], out[..., 1]) and np.array_equal(out[..., 0], out[..., 2])
    # Affine channels (0.5 x, 0.25 + 0.5 x) resize to the same affine images.
    affine = np.stack([base, 0.5 * base, 0.25 + 0.5 * base], axis=-1).astype(np.float32)
    resized = area_resize(affine, 21, 30)
    assert np.allclose(resized[..., 1], 0.5 * resized[..., 0], atol=1e-6)
    assert np.allclose(resized[..., 2], 0.25 + 0.5 * resized[..., 0], atol=1e-6)
    single = area_resize(base[..., None], 21, 30)[..., 0]
    assert np.array_equal(out[..., 0], single)


def test_letterbox_fill_and_placement():
    content = np.full((2, 3, 3), 0.5, dtype=np.float32)
    canvas = letterbox(content, ContentBox(1, 0, 2, 3), 5, 3, 0.25)
    assert canvas.dtype == np.float32
    assert np.all(canvas[1:3] == 0.5)
    assert np.all(canvas[[0, 3, 4]] == 0.25)


def test_fill_value_comes_from_the_config(multi):
    config = with_size(multi, 8, 8)
    config["resize"]["fillValue"] = 0.25
    stored = np.full((4, 8), 1024 + 40, dtype=np.int16)
    tensor = preprocess_dicom_bytes(ct_bytes(stored), config).tensor
    assert np.all(tensor[:2] == 0.25) and np.all(tensor[6:] == 0.25)
    assert np.all(tensor[2:6, :, 0] == 0.5)


# --- orientation -------------------------------------------------------------


def test_no_flip_or_rotation(multi):
    # Distinct markers in three corners of a 6 x 8 slice (identity resize).
    hu = np.full((6, 8), -2000, dtype=np.int16)
    hu[0, 0] = 40  # top-left: soft 0.5
    hu[0, 7] = 240  # top-right: soft 1.0
    hu[5, 0] = 140  # bottom-left: soft 0.75
    stored = (hu + 1024).astype(np.int16)
    tensor = preprocess_dicom_bytes(ct_bytes(stored), with_size(multi, 6, 8)).tensor[..., 0]
    assert tensor[0, 0] == 0.5 and tensor[0, 7] == 1.0 and tensor[5, 0] == 0.75
    assert tensor[5, 7] == 0.0
    assert np.count_nonzero(tensor) == 3


# --- WINDOW_THEN_RESIZE ------------------------------------------------------


def test_window_then_resize_differs_from_resize_hu_then_window(multi):
    # Soft tissue (40 HU) next to metal (3000 HU), downscaled 2:1.
    hu = np.array([[40, 3000], [40, 3000]], dtype=np.float32)
    soft, lung = (40, 400), (-600, 1500)

    window_first = area_resize(apply_window(hu, *soft)[..., None], 1, 1)[0, 0, 0]
    resize_first = apply_window(area_resize(hu[..., None], 1, 1)[..., 0], *soft)[0, 0]
    assert window_first == pytest.approx(0.75)  # mean of 0.5 and 1.0
    assert resize_first == 1.0  # mean HU 1520 clips to the upper bound
    lung_window_first = area_resize(apply_window(hu, *lung)[..., None], 1, 1)[0, 0, 0]
    lung_resize_first = apply_window(area_resize(hu[..., None], 1, 1)[..., 0], *lung)[0, 0]
    assert lung_window_first == pytest.approx((1390 / 1500 + 1) / 2)
    assert lung_resize_first == 1.0

    # The pipeline is WINDOW_THEN_RESIZE.
    stored = (hu + 1024).astype(np.int16)
    tensor = preprocess_dicom_bytes(ct_bytes(stored), with_size(multi, 1, 1)).tensor
    assert tensor[0, 0, 0] == pytest.approx(0.75)
    assert tensor[0, 0, 1] == pytest.approx((1390 / 1500 + 1) / 2)
