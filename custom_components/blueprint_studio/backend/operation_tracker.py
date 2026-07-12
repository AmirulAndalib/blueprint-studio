"""Track entry-owned HTTP operations during integration shutdown."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from collections.abc import Awaitable, Callable
from functools import wraps
from typing import Any, TypeVar

from aiohttp import web


_Handler = TypeVar("_Handler", bound=Callable[..., Awaitable[web.StreamResponse]])
_LOGGER = logging.getLogger(__name__)


class OperationTracker:
    """Reject new work during shutdown and drain active request tasks."""

    def __init__(self) -> None:
        self._closing = False
        self._tasks: set[asyncio.Task[Any]] = set()
        self._drained = asyncio.Event()
        self._drained.set()

    def acquire(self) -> asyncio.Task[Any]:
        """Register the current request task, unless shutdown has started."""
        if self._closing:
            raise RuntimeError("Blueprint Studio is shutting down")
        task = asyncio.current_task()
        if task is None:
            raise RuntimeError("Operation must run in an asyncio task")
        self._tasks.add(task)
        self._drained.clear()
        return task

    def release(self, task: asyncio.Task[Any]) -> None:
        """Release a previously acquired request task."""
        self._tasks.discard(task)
        if not self._tasks:
            self._drained.set()

    def snapshot(self) -> dict[str, int | bool]:
        """Return path-free request state for diagnostics."""
        return {"ready": not self._closing, "active_operations": len(self._tasks)}

    async def async_close(self, grace_period: float = 5.0) -> None:
        """Stop new work, briefly drain active work, then cancel stragglers."""
        self._closing = True
        if not self._tasks:
            return
        try:
            await asyncio.wait_for(self._drained.wait(), timeout=grace_period)
            return
        except TimeoutError:
            pass

        current = asyncio.current_task()
        tasks = tuple(task for task in self._tasks if task is not current)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


class TransferRegistry:
    """Own cancellation signals and worker threads for streamed transfers."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._workers: dict[threading.Thread, threading.Event] = {}
        self._closing = False

    def register(self, thread: threading.Thread, stopped: threading.Event) -> None:
        """Retain a transfer worker until it exits."""
        with self._lock:
            if self._closing:
                stopped.set()
                raise RuntimeError("Transfer manager is shutting down")
            self._workers[thread] = stopped

    def release(self, thread: threading.Thread) -> None:
        """Forget a completed transfer worker."""
        with self._lock:
            self._workers.pop(thread, None)

    def stop_all(self) -> tuple[threading.Thread, ...]:
        """Reject new transfers and signal every active producer."""
        with self._lock:
            self._closing = True
            workers = tuple(self._workers.items())
        for _, stopped in workers:
            stopped.set()
        return tuple(thread for thread, _ in workers)

    def snapshot(self) -> dict[str, int | bool]:
        """Return path-free worker state for diagnostics."""
        with self._lock:
            return {"ready": not self._closing, "active_transfers": len(self._workers)}

    @staticmethod
    def join(workers: tuple[threading.Thread, ...], timeout: float = 5.0) -> None:
        """Wait a bounded total time for producer threads to exit."""
        end = time.monotonic() + timeout
        for thread in workers:
            remaining = end - time.monotonic()
            if remaining <= 0:
                break
            thread.join(remaining)


def tracked_operation(handler: _Handler) -> _Handler:
    """Lease a request task from the view's operation tracker."""

    @wraps(handler)
    async def wrapped(self, *args, **kwargs):
        request = args[0] if args else kwargs.get("request")
        correlation_id = (
            request.headers.get("X-Correlation-ID") if request is not None else None
        )
        correlation_id = correlation_id or uuid.uuid4().hex
        if request is not None:
            request["blueprint_studio_correlation_id"] = correlation_id
        started = time.monotonic()
        response = None
        tracker = getattr(self, "operations", None)
        if tracker is None:
            response = await handler(self, *args, **kwargs)
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        try:
            task = tracker.acquire()
        except RuntimeError:
            response = web.Response(status=503, text="Blueprint Studio is unavailable")
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        try:
            try:
                response = await handler(self, *args, **kwargs)
            except web.HTTPException as err:
                response = err
                raise
            response.headers["X-Correlation-ID"] = correlation_id
            return response
        finally:
            tracker.release(task)
            duration_ms = round((time.monotonic() - started) * 1000)
            operation = (
                request.get("blueprint_studio_operation")
                if request is not None
                else None
            )
            if not operation and request is not None:
                operation = request.query.get("action")
            operation = operation or handler.__name__
            status = getattr(response, "status", 500)
            log = _LOGGER.warning if status >= 500 else _LOGGER.debug
            log(
                "manager=http operation=%s result=%s status=%s duration_ms=%s correlation_id=%s",
                operation,
                "error" if status >= 400 else "success",
                status,
                duration_ms,
                correlation_id,
            )

    return wrapped  # type: ignore[return-value]
