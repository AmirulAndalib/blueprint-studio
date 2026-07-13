import pytest


pytest.importorskip("homeassistant")
pytest.importorskip("pytest_homeassistant_custom_component")


@pytest.fixture(autouse=True)
def enable_blueprint_studio(enable_custom_integrations):
    """Enable loading Blueprint Studio from custom_components."""
    yield
