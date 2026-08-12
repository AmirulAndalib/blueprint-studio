from homeassistant import data_entry_flow

from custom_components.blueprint_studio.config_flow import BlueprintStudioConfigFlow


async def test_user_flow_aborts_when_entry_exists(monkeypatch):
    """Only one Blueprint Studio config entry may exist."""
    flow = BlueprintStudioConfigFlow()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [object()])
    result = await flow.async_step_user()

    assert result["type"] is data_entry_flow.FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"
