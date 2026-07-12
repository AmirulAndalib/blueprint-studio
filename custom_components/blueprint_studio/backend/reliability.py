"""Runtime-owned concurrency and timeout policy for backend operations."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator


GIT_MUTATIONS = frozenset(
    {
        "git_pull",
        "git_push",
        "git_push_only",
        "git_commit",
        "git_init",
        "git_add_remote",
        "git_remove_remote",
        "git_delete_repo",
        "git_repair_index",
        "git_rename_branch",
        "git_merge_unrelated",
        "git_force_push",
        "git_hard_reset",
        "git_delete_remote_branch",
        "git_checkout_branch",
        "git_create_branch",
        "git_delete_local_branch",
        "git_merge_branch",
        "git_resolve_conflict",
        "git_abort",
        "git_stage",
        "git_unstage",
        "git_reset",
        "git_clean_locks",
        "git_stop_tracking",
        "gitea_pull",
        "gitea_push",
        "gitea_push_only",
        "gitea_add_remote",
        "gitea_remove_remote",
        "gitea_create_repo",
    }
)

TRANSFER_ACTIONS = frozenset(
    {
        "download_multi",
        "prepare_download_multi",
        "upload_file",
        "upload_folder",
        "sftp_upload_folder",
        "sftp_download_folder",
        "sftp_prepare_stream",
    }
)


class OperationCoordinator:
    """Bound expensive work and serialize repository mutations."""

    def __init__(self) -> None:
        self._limits = {
            "git": asyncio.Semaphore(2),
            "sftp": asyncio.Semaphore(4),
            "search": asyncio.Semaphore(2),
            "terminal": asyncio.Semaphore(4),
            "expensive": asyncio.Semaphore(4),
        }
        self._git_mutation_lock = asyncio.Lock()

    def category(self, action: str) -> str | None:
        if action.startswith(("git_", "gitea_", "github_")):
            return "git"
        if action.startswith("sftp_"):
            return "sftp"
        if action in {"global_search", "global_replace"}:
            return "search"
        if action == "terminal_exec":
            return "terminal"
        if action in {"check_python", "check_javascript", "convert_to_blueprint"}:
            return "expensive"
        return None

    def timeout(self, action: str) -> float | None:
        """Return a total timeout only for non-transfer operations."""
        if action in TRANSFER_ACTIONS:
            return None
        if action.startswith(("git_", "gitea_", "github_")):
            return 310.0
        if action.startswith("sftp_"):
            return 120.0
        if action == "terminal_exec":
            return 35.0
        if action.startswith("ai_"):
            return 70.0
        return None

    def snapshot(self) -> dict[str, object]:
        """Return concurrency state without operation arguments."""
        return {
            "queued_jobs": sum(
                len(limit._waiters or ()) for limit in self._limits.values()
            ),
            "available_slots": {
                category: limit._value for category, limit in self._limits.items()
            },
            "git_mutation_active": self._git_mutation_lock.locked(),
        }

    @asynccontextmanager
    async def admit(self, action: str) -> AsyncIterator[float | None]:
        """Acquire the action's bounded slot and optional mutation lock."""
        limit = self._limits.get(self.category(action) or "")
        mutation_lock = self._git_mutation_lock if action in GIT_MUTATIONS else None
        if limit:
            await limit.acquire()
        try:
            if mutation_lock:
                await mutation_lock.acquire()
            try:
                yield self.timeout(action)
            finally:
                if mutation_lock:
                    mutation_lock.release()
        finally:
            if limit:
                limit.release()
