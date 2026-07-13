"""Generated transfer tests that never commit or allocate large fixtures."""

from __future__ import annotations

import tracemalloc


CHUNK_SIZE = 1024 * 1024
SIMULATED_SIZE = 3 * 1024 * 1024 * 1024


def _generated_stream(total: int, chunk_size: int = CHUNK_SIZE):
    chunk = b"x" * chunk_size
    remaining = total
    while remaining:
        view_size = min(chunk_size, remaining)
        yield memoryview(chunk)[:view_size]
        remaining -= view_size


def test_multi_gigabyte_generated_stream_has_bounded_memory():
    """Counting 3 GiB must retain one chunk, not a 3 GiB payload."""
    tracemalloc.start()
    total = sum(len(chunk) for chunk in _generated_stream(SIMULATED_SIZE))
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    assert total == SIMULATED_SIZE
    assert peak < CHUNK_SIZE * 3


def test_generated_stream_can_stop_on_disconnect_without_buffering_tail():
    stream = _generated_stream(SIMULATED_SIZE)
    consumed = sum(len(next(stream)) for _ in range(4))
    stream.close()

    assert consumed == 4 * CHUNK_SIZE
