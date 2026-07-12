"""Diagnostics support for Blueprint Studio."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .backend.runtime import BlueprintStudioRuntime
from .backend.storage import CURRENT_STORAGE_VERSION
from .const import VERSION


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> dict[str, Any]:
    """Return issue-report diagnostics without paths, content, or secrets."""
    runtime = getattr(entry, "runtime_data", None)
    if not isinstance(runtime, BlueprintStudioRuntime):
        return {
            "integration_version": VERSION,
            "storage_version": CURRENT_STORAGE_VERSION,
            "runtime": {"ready": False},
        }

    return {
        "integration_version": VERSION,
        "storage_version": CURRENT_STORAGE_VERSION,
        "runtime": runtime.diagnostics_snapshot(),
    }
