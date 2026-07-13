"""Contract checks for redacted Phase 7 diagnostics."""
from pathlib import Path


ROOT = Path(__file__).parents[1] / "custom_components/blueprint_studio"


def test_diagnostics_exposes_operational_counts_without_persisted_data():
    source = (ROOT / "diagnostics.py").read_text(encoding="utf-8")

    assert "runtime.diagnostics_snapshot()" in source
    assert "entry.data" not in source
    assert "runtime.data" not in source
    assert "runtime.store" not in source


def test_runtime_diagnostics_do_not_include_paths_or_credentials():
    source = (ROOT / "backend/runtime.py").read_text(encoding="utf-8")
    method = source.split("def diagnostics_snapshot", 1)[1].split("async def async_shutdown", 1)[0]

    for sensitive_source in (
        "self.data",
        "self.store",
        "self.hass.config",
        "self.file.config_dir",
        "self.sftp._stream_tokens",
        "self.tickets._tickets",
    ):
        assert sensitive_source not in method
