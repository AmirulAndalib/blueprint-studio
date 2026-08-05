"""Runtime ownership for a Blueprint Studio config entry."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from homeassistant.core import HomeAssistant
from .ai_manager import AIManager
from .file_manager import FileManager
from .git_manager import GitManager
from .ha_metadata import HAMetadataManager
from .operation_tracker import OperationTracker
from .reliability import OperationCoordinator
from .sftp_manager import SftpManager
from .storage import BlueprintStudioStorage, BlueprintStudioStore
from .terminal_manager import TerminalManager
from .ticket_manager import TicketManager


@dataclass(slots=True)
class BlueprintStudioRuntime:
    """Own the resources created for one Blueprint Studio config entry."""

    hass: HomeAssistant
    store: BlueprintStudioStore
    data: BlueprintStudioStorage
    git: GitManager
    ai: AIManager
    file: FileManager
    metadata: HAMetadataManager
    sftp: SftpManager
    terminal: TerminalManager
    tickets: TicketManager = field(default_factory=TicketManager)
    operations: OperationTracker = field(default_factory=OperationTracker)
    coordinator: OperationCoordinator = field(default_factory=OperationCoordinator)
    _unsubscribers: list[Callable[[], None]] = field(default_factory=list)
    _tasks: set[asyncio.Future[Any]] = field(default_factory=set)

    @classmethod
    async def async_create(
        cls,
        hass: HomeAssistant,
        storage_key: str,
    ) -> BlueprintStudioRuntime:
        """Load persisted data and construct entry-scoped managers."""
        store = BlueprintStudioStore(hass, storage_key)
        data = cast(BlueprintStudioStorage, await store.async_load() or {})

        config_dir = Path(hass.config.config_dir)
        file_manager = FileManager(hass, config_dir)
        metadata = HAMetadataManager(hass)
        runtime = cls(
            hass=hass,
            store=store,
            data=data,
            git=GitManager(hass, config_dir, data, store),
            ai=AIManager(hass, data, file_manager, metadata),
            file=file_manager,
            metadata=metadata,
            sftp=SftpManager(config_dir),
            terminal=TerminalManager(hass),
        )
        await runtime.metadata.async_get()
        runtime.metadata.subscribe()
        return runtime

    def add_unsubscriber(self, unsubscribe: Callable[[], None]) -> None:
        """Retain an event unsubscriber for entry unload."""
        self._unsubscribers.append(unsubscribe)

    def create_task(self, coro: Coroutine[Any, Any, Any]) -> asyncio.Future[Any]:
        """Create and retain a background task until it finishes."""
        task = self.hass.async_create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def diagnostics_snapshot(self) -> dict[str, object]:
        """Return redacted, path-free operational state."""
        return {
            "ready": self.operations.snapshot()["ready"],
            "operations": self.operations.snapshot(),
            "coordinator": self.coordinator.snapshot(),
            "file_manager": self.file.diagnostics_snapshot(),
            "sftp_manager": self.sftp.diagnostics_snapshot(),
            "terminal_manager": self.terminal.diagnostics_snapshot(),
            "ai_manager": self.ai.diagnostics_snapshot(),
            "tickets": self.tickets.snapshot(),
            "background_tasks": len(self._tasks),
            "managers": {"git": True, "ai": True},
        }

    async def async_shutdown(self) -> None:
        """Release all entry-scoped subscriptions, tasks, and connections."""
        for unsubscribe in self._unsubscribers:
            unsubscribe()
        self._unsubscribers.clear()

        self.tickets.clear()
        await self.operations.async_close()
        await self.terminal.async_close()
        await self.file.async_close()
        await self.metadata.async_close()
        if self.ai.proposals is not None:
            self.ai.proposals.clear()

        tasks = tuple(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()

        await self.sftp.async_close(self.hass)
