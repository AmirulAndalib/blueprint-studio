"""Repository-wide pytest compatibility hooks."""

from __future__ import annotations

import importlib


def pytest_runtest_setup():
    """Restore Home Assistant's lazy logging namespace after fixture cleanup."""
    try:
        homeassistant = importlib.import_module("homeassistant")
        util = importlib.import_module("homeassistant.util")
        logging = importlib.import_module("homeassistant.util.logging")
        homeassistant.util = util
        util.logging = logging
    except ModuleNotFoundError:
        pass
