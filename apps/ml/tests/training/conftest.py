import pytest

from training_helpers import no_network


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """PR11 tests never reach the network (no ImageNet download)."""
    no_network(monkeypatch)
