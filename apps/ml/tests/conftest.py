import copy

import pytest

from childbex_ml.preprocessing import load_preset


@pytest.fixture
def multi():
    return load_preset("ct-multi-window-v1")


@pytest.fixture
def single():
    return load_preset("ct-single-window-v1")


def with_size(config: dict, height: int, width: int) -> dict:
    """A copy with another output size (e.g. the input size: identity resize)."""
    changed = copy.deepcopy(config)
    changed["resize"]["height"] = height
    changed["resize"]["width"] = width
    return changed
