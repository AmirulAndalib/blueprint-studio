"""Git reliability checks for serialization and subprocess time bounds."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).parents[1] / "custom_components/blueprint_studio/backend"


def test_git_subprocesses_have_finite_timeouts_and_capture_output():
    source = (ROOT / "git_manager.py").read_text(encoding="utf-8")

    assert "subprocess.run(" in source
    assert "timeout=timeout" in source
    assert "capture_output=True" in source
    assert "except Exception as err:" in source


def test_runtime_coordinator_wraps_dispatched_operations():
    source = (ROOT / "api.py").read_text(encoding="utf-8")

    assert "async with self.coordinator.admit(action) as timeout:" in source
