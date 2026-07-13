import pytest


pytestmark = pytest.mark.ha


async def test_home_assistant_fixture_is_available(hass):
    """Prove the custom-component Home Assistant fixture harness starts."""
    assert hass.config.config_dir
