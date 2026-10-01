"""LINEAR_CLIP_V1 windowing and channel semantics."""

import numpy as np
import pytest

from childbex_ml.preprocessing import preprocess_dicom_bytes
from childbex_ml.preprocessing.window import apply_window, window_channels, window_limits
from conftest import with_size
from synthetic import ct_bytes


def window(values, center, width):
    return apply_window(np.array(values, dtype=np.float32), center, width)


def test_limits():
    assert window_limits(40, 400) == (np.float32(-160), np.float32(240))
    assert window_limits(-600, 1500) == (np.float32(-1350), np.float32(150))
    assert window_limits(500, 2000) == (np.float32(-500), np.float32(1500))


def test_below_window_maps_to_zero():
    assert window([-161, -1000, -3024, -2048], 40, 400).tolist() == [0.0, 0.0, 0.0, 0.0]


def test_above_window_maps_to_one():
    assert window([241, 1000, 3071, 30000], 40, 400).tolist() == [1.0, 1.0, 1.0, 1.0]


def test_bounds_center_and_intermediate_values():
    result = window([-160, -60, 40, 140, 240], 40, 400)
    assert result.tolist() == [0.0, 0.25, 0.5, 0.75, 1.0]
    assert window([-975], -600, 1500).tolist() == [0.25]  # (-975 + 1350) / 1500


def test_formula_is_float32_clip_subtract_divide():
    hu = np.linspace(-3000, 3000, 1001, dtype=np.float32)
    lower, upper = np.float32(-1350), np.float32(150)
    expected = (np.clip(hu, lower, upper) - lower) / np.float32(upper - lower)
    assert np.array_equal(window(hu, -600, 1500), expected.astype(np.float32))


def test_output_float32_within_unit_range_and_monotonic():
    hu = np.linspace(-5000, 5000, 20001, dtype=np.float32)
    for center, width in [(40, 400), (-600, 1500), (500, 2000), (0.5, 0.001)]:
        out = window(hu, center, width)
        assert out.dtype == np.float32
        assert out.min() >= 0.0 and out.max() <= 1.0
        assert np.all(np.diff(out) >= 0)


def test_each_channel_uses_its_own_window_in_order(multi):
    hu = np.array([[-1350, -160], [150, 1500]], dtype=np.float32)
    channels = window_channels(hu, multi)
    assert channels.shape == (2, 2, 3) and channels.dtype == np.float32
    assert np.array_equal(channels[..., 0], window(hu, 40, 400))
    assert np.array_equal(channels[..., 1], window(hu, -600, 1500))
    assert np.array_equal(channels[..., 2], window(hu, 500, 2000))


def test_exact_channel_order_through_the_pipeline(multi):
    # HU = stored - 1024 (4 x 4, identity resize).
    hu = np.array(
        [[40, -600, 500, -2000], [240, 150, 1500, 3000], [-160, -1350, -500, 0], [140, -975, 1000, 100]]
    )
    data = ct_bytes((hu + 1024).astype(np.int16))
    tensor = preprocess_dicom_bytes(data, with_size(multi, 4, 4)).tensor
    assert tensor[0, 0].tolist() == [0.5, pytest.approx((40 + 1350) / 1500), pytest.approx((40 + 500) / 2000)]
    assert tensor[0, 1].tolist()[1] == pytest.approx(0.5)  # lung center
    assert tensor[0, 2].tolist()[2] == 0.5  # bone center
    assert tensor[1, 0].tolist()[0] == 1.0  # soft upper bound
    assert tensor[2, 1].tolist() == [0.0, 0.0, 0.0]  # below all lower bounds
    assert tensor[1, 3].tolist() == [1.0, 1.0, 1.0]  # above all upper bounds
    hu_f = hu.astype(np.float32)
    assert np.array_equal(tensor[..., 0], window(hu_f, 40, 400))
    assert np.array_equal(tensor[..., 1], window(hu_f, -600, 1500))
    assert np.array_equal(tensor[..., 2], window(hu_f, 500, 2000))


def test_single_window_replicates_soft_tissue_into_three_identical_channels(single, multi):
    stored = (np.arange(-1500, 1700, 200, dtype=np.int16).reshape(4, 4) + 1024).astype(np.int16)
    data = ct_bytes(stored)
    tensor = preprocess_dicom_bytes(data, with_size(single, 4, 4)).tensor
    assert tensor.shape == (4, 4, 3) and tensor.dtype == np.float32
    assert np.array_equal(tensor[..., 0], tensor[..., 1])
    assert np.array_equal(tensor[..., 0], tensor[..., 2])
    multi_tensor = preprocess_dicom_bytes(data, with_size(multi, 4, 4)).tensor
    assert np.array_equal(tensor[..., 0], multi_tensor[..., 0])
