"""Typed, versioned persistence for Blueprint Studio."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, NotRequired, TypedDict

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store


class ProviderCredentials(TypedDict):
    """Persisted credentials for a Git provider."""

    username: str
    token: str | None


class BlueprintStudioStorage(TypedDict, total=False):
    """Current storage shape.

    Settings and unknown root keys intentionally remain open-ended because the
    frontend owns workspace fields and older releases added fields dynamically.
    """

    settings: dict[str, Any]
    credentials: ProviderCredentials
    github_credentials: ProviderCredentials
    gitea_credentials: ProviderCredentials
    schema_version: NotRequired[int]


CURRENT_STORAGE_VERSION = 2


def migrate_storage_data(
    old_major_version: int,
    old_minor_version: int,
    old_data: dict[str, Any],
) -> BlueprintStudioStorage:
    """Return a validated, lossless migration of a historical storage shape."""
    if not isinstance(old_data, dict):
        raise ValueError("Blueprint Studio storage root must be an object")
    if old_major_version < 1 or old_major_version > CURRENT_STORAGE_VERSION:
        raise ValueError(
            f"Unsupported Blueprint Studio storage version {old_major_version}.{old_minor_version}"
        )

    migrated: dict[str, Any] = deepcopy(old_data)
    settings = migrated.get("settings", {})
    if not isinstance(settings, dict):
        raise ValueError("Blueprint Studio settings must be an object")
    migrated["settings"] = settings

    # The original unversioned migration moved these root fields but rebuilt the
    # entire object. Move only the known keys so workspace and future fields live.
    if "username" in migrated and "credentials" not in migrated:
        username = migrated.pop("username")
        token = migrated.pop("token", None)
        if not isinstance(username, str):
            raise ValueError("Legacy Blueprint Studio username must be a string")
        if token is not None and not isinstance(token, str):
            raise ValueError("Legacy Blueprint Studio token must be a string or null")
        migrated["credentials"] = {"username": username, "token": token}

    migrated["schema_version"] = CURRENT_STORAGE_VERSION
    return migrated  # type: ignore[return-value]


class BlueprintStudioStore(Store[BlueprintStudioStorage]):
    """Home Assistant store with explicit migration ownership."""

    def __init__(self, hass: HomeAssistant, key: str) -> None:
        super().__init__(hass, CURRENT_STORAGE_VERSION, key, private=True)

    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> BlueprintStudioStorage:
        """Migrate and validate before Home Assistant atomically saves data."""
        return migrate_storage_data(old_major_version, old_minor_version, old_data)
