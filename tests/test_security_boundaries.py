"""Behavioral security regression tests for filesystem and ticket boundaries."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types


ROOT = Path(__file__).parents[1] / "custom_components/blueprint_studio/backend"


def _load_util_module():
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    core.HomeAssistant = object
    previous = {
        "homeassistant": sys.modules.get("homeassistant"),
        "homeassistant.core": sys.modules.get("homeassistant.core"),
    }
    sys.modules.update({"homeassistant": homeassistant, "homeassistant.core": core})
    try:
        spec = importlib.util.spec_from_file_location(
            "blueprint_studio_util_test", ROOT / "util.py"
        )
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module
    finally:
        for name, old in previous.items():
            if old is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old


def test_path_traversal_and_absolute_paths_are_rejected(tmp_path):
    util = _load_util_module()
    root = (tmp_path / "config").resolve()
    root.mkdir()

    assert util.is_path_safe(root, "automations.yaml")
    assert not util.is_path_safe(root, "../secrets.yaml")
    assert not util.is_path_safe(root, "/../etc/passwd")


def test_symlink_escape_is_rejected(tmp_path):
    util = _load_util_module()
    root = (tmp_path / "config").resolve()
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "secret.txt").write_text("secret", encoding="utf-8")
    (root / "escape").symlink_to(outside, target_is_directory=True)

    assert not util.is_path_safe(root, "escape/secret.txt")
    assert util.get_safe_path(root, "escape/secret.txt") is None
