"""Lifecycle coverage for entry-owned backend resources."""
from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace


def _load_terminal_manager_module():
    path = (
        Path(__file__).parents[1]
        / "custom_components/blueprint_studio/backend/terminal_manager.py"
    )
    spec = importlib.util.spec_from_file_location("blueprint_studio_terminal", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class _WebSocket:
    closed = False

    def __init__(self) -> None:
        self.close_args = None

    async def close(self, **kwargs) -> None:
        self.close_args = kwargs
        self.closed = True


def test_terminal_manager_closes_active_sessions(monkeypatch):
    """Unload closes each WebSocket, reader, file descriptor, and child PTY."""
    module = _load_terminal_manager_module()
    removed_readers = []
    killed = []
    closed_fds = []
    loop = SimpleNamespace(remove_reader=removed_readers.append)
    manager = module.TerminalManager(SimpleNamespace(loop=loop))
    websocket = _WebSocket()
    session = manager.create_session(websocket)
    session.set_pty(42, 1234)

    monkeypatch.setattr(module.os, "kill", lambda pid, sig: killed.append((pid, sig)))
    monkeypatch.setattr(module.os, "waitpid", lambda pid, flags: None)
    monkeypatch.setattr(module.os, "close", closed_fds.append)

    asyncio.run(manager.async_close())

    assert removed_readers == [42]
    assert killed == [(1234, module.signal.SIGTERM)]
    assert closed_fds == [42]
    assert websocket.closed
    assert websocket.close_args["code"] == 1001
    assert not manager._sessions


def test_terminal_manager_rejects_sessions_after_close():
    """No terminal operation can start once shutdown begins."""
    module = _load_terminal_manager_module()
    manager = module.TerminalManager(SimpleNamespace(loop=asyncio.new_event_loop()))
    asyncio.run(manager.async_close())

    try:
        manager.create_session(_WebSocket())
    except RuntimeError as err:
        assert "shutting down" in str(err)
    else:
        raise AssertionError("session was accepted after shutdown")
