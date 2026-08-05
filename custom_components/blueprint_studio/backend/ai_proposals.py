"""Bounded, immutable AI edit proposals awaiting explicit review."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath, PureWindowsPath
import secrets
import threading
import time
from typing import Any

from ..const import EXCLUDED_PATTERNS, PROTECTED_PATHS
from .util import get_safe_path


MAX_PROPOSALS = 20
MAX_UNDO_RECORDS = 20
MAX_EDITS_PER_PROPOSAL = 20
MAX_PROPOSAL_BYTES = 1024 * 1024
PROPOSAL_TTL_SECONDS = 15 * 60
MISSING_CONTENT_HASH = hashlib.sha256(b"").hexdigest()


class ProposalError(ValueError):
    """Base error for invalid or unavailable proposals."""


class ProposalNotFound(ProposalError):
    pass


class ProposalExpired(ProposalError):
    pass


@dataclass(frozen=True, slots=True)
class ProposalEdit:
    path: str
    operation: str
    old_content: str | None
    new_content: str
    source_hash: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "operation": self.operation,
            "old_content": self.old_content,
            "new_content": self.new_content,
            "source_hash": self.source_hash,
        }


@dataclass(frozen=True, slots=True)
class EditProposal:
    id: str
    created_at: float
    expires_at: float
    edits: tuple[ProposalEdit, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "expires_at": self.expires_at,
            "edits": [edit.as_dict() for edit in self.edits],
        }


@dataclass(frozen=True, slots=True)
class UndoEdit:
    path: str
    applied_hash: str
    restore_content: str | None


@dataclass(frozen=True, slots=True)
class ProposalUndo:
    id: str
    created_at: float
    expires_at: float
    edits: tuple[UndoEdit, ...]


class AIProposalStore:
    """Entry-scoped proposal storage with strict path and memory bounds."""

    def __init__(
        self,
        config_dir: Path,
        *,
        ttl_seconds: int = PROPOSAL_TTL_SECONDS,
        max_proposals: int = MAX_PROPOSALS,
    ) -> None:
        self.config_dir = config_dir.resolve()
        self.ttl_seconds = ttl_seconds
        self.max_proposals = max_proposals
        self._proposals: dict[str, EditProposal] = {}
        self._undos: dict[str, ProposalUndo] = {}
        self._lock = threading.Lock()

    def _clean_path(self, raw_path: str) -> tuple[str, Path]:
        path = raw_path.strip()
        pure_path = PurePosixPath(path)
        if (
            not path
            or "\x00" in path
            or path.startswith(("/", "\\"))
            or "\\" in path
            or pure_path.is_absolute()
            or PureWindowsPath(path).is_absolute()
            or any(part in {"", ".", ".."} for part in pure_path.parts)
        ):
            raise ProposalError("Proposed edit path is not a safe relative path")
        normalized = pure_path.as_posix()
        root_name = normalized.split("/", 1)[0]
        if root_name in PROTECTED_PATHS or normalized in PROTECTED_PATHS:
            raise ProposalError("Proposed edit targets a protected path")
        if root_name in EXCLUDED_PATTERNS:
            raise ProposalError("Proposed edit targets an excluded workspace path")
        safe_path = get_safe_path(self.config_dir, normalized)
        if safe_path is None:
            raise ProposalError("Proposed edit path is outside the workspace")
        return normalized, safe_path

    def create(
        self, raw_edits: list[tuple[str, str]], *, now: float | None = None
    ) -> EditProposal:
        """Validate parsed edit blocks and retain one immutable proposal."""
        if not raw_edits:
            raise ProposalError("No edit blocks were found")
        if len(raw_edits) > MAX_EDITS_PER_PROPOSAL:
            raise ProposalError("Too many edit blocks in one proposal")
        total_bytes = sum(len(content.encode("utf-8")) for _, content in raw_edits)
        if total_bytes > MAX_PROPOSAL_BYTES:
            raise ProposalError("Proposed edits exceed the size limit")

        edits: list[ProposalEdit] = []
        seen: set[str] = set()
        for raw_path, new_content in raw_edits:
            path, safe_path = self._clean_path(raw_path)
            if path in seen:
                raise ProposalError("Duplicate edit path in proposal")
            seen.add(path)
            if safe_path.exists() and not safe_path.is_file():
                raise ProposalError("Proposed edit path is not a file")
            try:
                old_content = (
                    safe_path.read_text(encoding="utf-8")
                    if safe_path.exists()
                    else None
                )
            except (OSError, UnicodeError) as err:
                raise ProposalError(
                    "Proposed edit target is not a readable text file"
                ) from err
            source_bytes = b"" if old_content is None else old_content.encode("utf-8")
            total_bytes += len(source_bytes)
            if total_bytes > MAX_PROPOSAL_BYTES:
                raise ProposalError("Proposed edits exceed the size limit")
            edits.append(
                ProposalEdit(
                    path=path,
                    operation="create" if old_content is None else "replace",
                    old_content=old_content,
                    new_content=new_content,
                    source_hash=hashlib.sha256(source_bytes).hexdigest(),
                )
            )

        timestamp = time.time() if now is None else now
        proposal = EditProposal(
            id=secrets.token_urlsafe(24),
            created_at=timestamp,
            expires_at=timestamp + self.ttl_seconds,
            edits=tuple(edits),
        )
        with self._lock:
            self._purge_expired(timestamp)
            while len(self._proposals) >= self.max_proposals:
                oldest = min(self._proposals.values(), key=lambda item: item.created_at)
                self._proposals.pop(oldest.id, None)
            self._proposals[proposal.id] = proposal
        return proposal

    def take(self, proposal_id: str, *, now: float | None = None) -> EditProposal:
        """Remove a live proposal so it can be applied at most once."""
        timestamp = time.time() if now is None else now
        with self._lock:
            proposal = self._proposals.get(proposal_id)
            if proposal is None:
                raise ProposalNotFound("Proposal was not found or already handled")
            if proposal.expires_at <= timestamp:
                self._proposals.pop(proposal_id, None)
                raise ProposalExpired("Proposal has expired")
            return self._proposals.pop(proposal_id)

    def get(self, proposal_id: str, *, now: float | None = None) -> EditProposal:
        """Return a live immutable proposal without consuming it."""
        timestamp = time.time() if now is None else now
        with self._lock:
            proposal = self._proposals.get(proposal_id)
            if proposal is None:
                raise ProposalNotFound("Proposal was not found or already handled")
            if proposal.expires_at <= timestamp:
                self._proposals.pop(proposal_id, None)
                raise ProposalExpired("Proposal has expired")
            return proposal

    def take_selected(
        self, proposal_id: str, selected_paths: list[str], *, now: float | None = None
    ) -> EditProposal:
        """Consume a proposal and return only explicitly selected edits."""
        proposal = self.get(proposal_id, now=now)
        requested = set(selected_paths)
        available = {edit.path for edit in proposal.edits}
        if not requested:
            raise ProposalError("Select at least one proposed file")
        if requested - available:
            raise ProposalError("Selected proposal files are not available")
        consumed = self.take(proposal_id, now=now)
        return EditProposal(
            id=consumed.id,
            created_at=consumed.created_at,
            expires_at=consumed.expires_at,
            edits=tuple(edit for edit in consumed.edits if edit.path in requested),
        )

    def revise(
        self,
        proposal_id: str,
        *,
        path: str | None = None,
        new_content: str | None = None,
        now: float | None = None,
    ) -> EditProposal:
        """Replace a proposal with a newly snapshotted reviewed revision."""
        proposal = self.get(proposal_id, now=now)
        if path is not None and path not in {edit.path for edit in proposal.edits}:
            raise ProposalError("Proposed file was not found")
        raw_edits = [
            (
                edit.path,
                new_content
                if path == edit.path and new_content is not None
                else edit.new_content,
            )
            for edit in proposal.edits
        ]
        revised = self.create(raw_edits, now=now)
        self.reject(proposal_id, now=now)
        return revised

    def reject(self, proposal_id: str, *, now: float | None = None) -> None:
        self.take(proposal_id, now=now)

    def record_apply(
        self, proposal: EditProposal, *, now: float | None = None
    ) -> ProposalUndo:
        """Retain a bounded, one-time restore snapshot after a successful apply."""
        timestamp = time.time() if now is None else now
        undo = ProposalUndo(
            id=secrets.token_urlsafe(24),
            created_at=timestamp,
            expires_at=timestamp + self.ttl_seconds,
            edits=tuple(
                UndoEdit(
                    path=edit.path,
                    applied_hash=hashlib.sha256(
                        edit.new_content.encode("utf-8")
                    ).hexdigest(),
                    restore_content=edit.old_content,
                )
                for edit in proposal.edits
            ),
        )
        with self._lock:
            self._purge_expired(timestamp)
            while len(self._undos) >= MAX_UNDO_RECORDS:
                oldest = min(self._undos.values(), key=lambda item: item.created_at)
                self._undos.pop(oldest.id, None)
            self._undos[undo.id] = undo
        return undo

    def take_undo(self, undo_id: str, *, now: float | None = None) -> ProposalUndo:
        """Consume a live restore snapshot so an apply can be undone once."""
        timestamp = time.time() if now is None else now
        with self._lock:
            undo = self._undos.get(undo_id)
            if undo is None:
                raise ProposalNotFound("Undo was not found or already handled")
            if undo.expires_at <= timestamp:
                self._undos.pop(undo_id, None)
                raise ProposalExpired("Undo has expired")
            return self._undos.pop(undo_id)

    def clear(self) -> None:
        with self._lock:
            self._proposals.clear()
            self._undos.clear()

    def _purge_expired(self, now: float) -> None:
        expired = [
            key
            for key, proposal in self._proposals.items()
            if proposal.expires_at <= now
        ]
        for key in expired:
            self._proposals.pop(key, None)
        expired_undos = [
            key for key, undo in self._undos.items() if undo.expires_at <= now
        ]
        for key in expired_undos:
            self._undos.pop(key, None)
