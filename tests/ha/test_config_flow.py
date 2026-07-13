import pytest

from homeassistant import config_entries
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.blueprint_studio.const import DOMAIN


pytestmark = pytest.mark.ha


async def test_user_flow_aborts_when_entry_exists(hass):
    """Only one Blueprint Studio config entry may exist."""
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)

    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
    )

    assert result["type"] is config_entries.ConfigFlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"
