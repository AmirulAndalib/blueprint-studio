"""Tests for scoped browser transport authorization tickets."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


def _load_module():
    path = Path(__file__).parents[1] / "custom_components/blueprint_studio/backend/ticket_manager.py"
    spec = importlib.util.spec_from_file_location("blueprint_studio_tickets", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_ticket_is_single_use_and_exactly_scoped():
    manager = _load_module().TicketManager()
    issued = manager.issue("admin", {"action": "serve_file", "path": "a.yaml"})

    assert manager.consume(issued["ticket"], {"action": "serve_file", "path": "b.yaml"}) is None
    assert manager.consume(issued["ticket"], {"action": "serve_file", "path": "a.yaml"}) is None


def test_ticket_exchange_rejects_replay_but_grant_supports_range_requests():
    manager = _load_module().TicketManager()
    scope = {"action": "serve_file", "path": "media/video.mp4"}
    issued = manager.issue("admin", scope)

    grant = manager.exchange_for_grant(issued["ticket"], scope)
    assert grant
    assert manager.exchange_for_grant(issued["ticket"], scope) is None
    assert manager.validate_grant(grant, scope).user_id == "admin"
    assert manager.validate_grant(grant, scope).user_id == "admin"
    assert manager.validate_grant(grant, {**scope, "path": "secrets.yaml"}) is None


def test_expired_and_cleared_tickets_are_rejected(monkeypatch):
    module = _load_module()
    now = [100.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    manager = module.TicketManager(ttl=5)
    expired = manager.issue("admin", {"action": "terminal"})["ticket"]
    now[0] += 6
    assert manager.consume(expired, {"action": "terminal"}) is None

    pending = manager.issue("admin", {"action": "terminal"})["ticket"]
    manager.clear()
    assert manager.consume(pending, {"action": "terminal"}) is None


def test_ticket_and_grant_registries_are_bounded_and_diagnostics_are_redacted():
    manager = _load_module().TicketManager(max_entries=2)
    issued = [manager.issue("admin", {"action": "terminal"}) for _ in range(3)]

    assert manager.consume(issued[0]["ticket"], {"action": "terminal"}) is None
    grants = [
        manager.exchange_for_grant(item["ticket"], {"action": "terminal"})
        for item in issued[1:]
    ]
    manager.issue("admin", {"action": "terminal"})
    manager.issue("admin", {"action": "terminal"})
    third = manager.issue("admin", {"action": "terminal"})
    grants.append(manager.exchange_for_grant(third["ticket"], {"action": "terminal"}))

    snapshot = manager.snapshot()
    assert snapshot["pending_tickets"] <= 2
    assert snapshot["active_grants"] <= 2
    assert "admin" not in repr(snapshot)
