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


def test_git_status_exposes_bounded_ignored_paths_without_counting_them_as_changes():
    source = (ROOT / "git_manager.py").read_text(encoding="utf-8")

    assert "MAX_IGNORED_STATUS_PATHS = 200" in source
    assert '"--ignored=matching"' in source
    assert "x_status == '!' and y_status == '!'" in source
    assert 'len(status_data["ignored"]) < MAX_IGNORED_STATUS_PATHS' in source
    changes_block = source.split("has_changes = any(", 1)[1].split("ahead = behind", 1)[
        0
    ]
    assert '"ignored"' not in changes_block


def test_github_credentials_are_verified_before_reporting_authentication():
    manager = (ROOT / "git_manager.py").read_text(encoding="utf-8")
    handlers = (ROOT / "api_git.py").read_text(encoding="utf-8")
    api = (ROOT / "api.py").read_text(encoding="utf-8")

    assert '"https://api.github.com/user"' in manager
    assert '"authenticated": False' in manager
    assert 'auth_status="authenticated"' in manager
    assert 'auth_status="invalid"' in manager
    assert 'auth_status="unavailable"' in manager
    assert "aiohttp.ClientTimeout(total=8, connect=4)" in manager
    assert "verify=data.get(\"verify\", False)" in handlers
    assert "self.git, d" in api
