"""Tests for bounded request draining during integration unload."""
from __future__ import annotations

import asyncio
import importlib.util
import threading
from pathlib import Path


def _load_module():
    path = (
        Path(__file__).parents[1]
        / "custom_components/blueprint_studio/backend/operation_tracker.py"
    )
    spec = importlib.util.spec_from_file_location("blueprint_studio_operations", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_operation_tracker_allows_active_work_to_drain():
    module = _load_module()

    async def run():
        tracker = module.OperationTracker()

        async def operation():
            task = tracker.acquire()
            await asyncio.sleep(0)
            tracker.release(task)

        task = asyncio.create_task(operation())
        await asyncio.sleep(0)
        await tracker.async_close(grace_period=1)
        await task
        assert not tracker._tasks

    asyncio.run(run())


def test_operation_tracker_cancels_after_grace_and_rejects_new_work():
    module = _load_module()

    async def run():
        tracker = module.OperationTracker()
        started = asyncio.Event()

        async def operation():
            task = tracker.acquire()
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                tracker.release(task)

        task = asyncio.create_task(operation())
        await started.wait()
        await tracker.async_close(grace_period=0)
        assert task.cancelled()
        try:
            tracker.acquire()
        except RuntimeError as err:
            assert "shutting down" in str(err)
        else:
            raise AssertionError("operation was accepted after shutdown")

    asyncio.run(run())


def test_transfer_registry_stops_and_joins_workers():
    module = _load_module()
    registry = module.TransferRegistry()
    stopped = threading.Event()

    def worker():
        stopped.wait()
        registry.release(thread)

    thread = threading.Thread(target=worker)
    registry.register(thread, stopped)
    thread.start()

    workers = registry.stop_all()
    registry.join(workers, timeout=1)

    assert stopped.is_set()
    assert not thread.is_alive()
    assert not registry._workers


def test_operational_snapshots_expose_counts_and_readiness():
    module = _load_module()

    async def run():
        tracker = module.OperationTracker()
        task = tracker.acquire()
        assert tracker.snapshot() == {"ready": True, "active_operations": 1}
        tracker.release(task)
        await tracker.async_close()
        assert tracker.snapshot() == {"ready": False, "active_operations": 0}

    asyncio.run(run())

    registry = module.TransferRegistry()
    assert registry.snapshot() == {"ready": True, "active_transfers": 0}
    registry.stop_all()
    assert registry.snapshot() == {"ready": False, "active_transfers": 0}
