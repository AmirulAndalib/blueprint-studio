"""Tests for bounded backend operation admission."""
import asyncio
import importlib.util
from pathlib import Path


def _coordinator_class():
    path = Path(__file__).parents[1] / "custom_components/blueprint_studio/backend/reliability.py"
    spec = importlib.util.spec_from_file_location("blueprint_studio_reliability", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.OperationCoordinator


def test_transfers_have_no_total_duration_timeout():
    coordinator = _coordinator_class()()

    assert coordinator.timeout("sftp_upload_folder") is None
    assert coordinator.timeout("download_multi") is None
    assert coordinator.timeout("git_pull") == 310.0
    assert coordinator.timeout("terminal_exec") == 35.0


def test_git_mutations_are_serialized():
    async def exercise():
        coordinator = _coordinator_class()()
        first_entered = asyncio.Event()
        release_first = asyncio.Event()
        second_entered = asyncio.Event()

        async def first():
            async with coordinator.admit("git_commit"):
                first_entered.set()
                await release_first.wait()

        async def second():
            await first_entered.wait()
            async with coordinator.admit("git_push"):
                second_entered.set()

        tasks = [asyncio.create_task(first()), asyncio.create_task(second())]
        await first_entered.wait()
        await asyncio.sleep(0)
        assert not second_entered.is_set()
        release_first.set()
        await asyncio.gather(*tasks)
        assert second_entered.is_set()

    asyncio.run(exercise())


def test_git_read_does_not_take_mutation_lock():
    async def exercise():
        coordinator = _coordinator_class()()
        both_entered = asyncio.Event()
        entered = 0

        async def read():
            nonlocal entered
            async with coordinator.admit("git_status"):
                entered += 1
                if entered == 2:
                    both_entered.set()
                await both_entered.wait()

        await asyncio.wait_for(
            asyncio.gather(asyncio.create_task(read()), asyncio.create_task(read())),
            timeout=1,
        )

    asyncio.run(exercise())
