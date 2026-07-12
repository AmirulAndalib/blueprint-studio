"""Short-lived, single-use authorization tickets for browser transports."""

from __future__ import annotations

from dataclasses import dataclass
import secrets
import threading
import time
from typing import Mapping


@dataclass(frozen=True, slots=True)
class ConnectionTicket:
    """Authorization captured when an authenticated admin issues a ticket."""

    user_id: str
    scope: tuple[tuple[str, str], ...]
    expires_at: float


class TicketManager:
    """Issue and atomically consume opaque connection tickets."""

    def __init__(self, ttl: int = 30, max_entries: int = 256) -> None:
        self.ttl = ttl
        self.max_entries = max_entries
        self._tickets: dict[str, ConnectionTicket] = {}
        self._grants: dict[str, ConnectionTicket] = {}
        self._lock = threading.Lock()

    @staticmethod
    def normalize_scope(scope: Mapping[str, object]) -> tuple[tuple[str, str], ...]:
        """Return a stable, exact-match representation of a ticket scope."""
        return tuple(sorted((str(key), str(value)) for key, value in scope.items()))

    def issue(self, user_id: str, scope: Mapping[str, object]) -> dict[str, object]:
        """Create a ticket for one user and one exact operation scope."""
        token = secrets.token_urlsafe(32)
        now = time.monotonic()
        ticket = ConnectionTicket(user_id, self.normalize_scope(scope), now + self.ttl)
        with self._lock:
            self._purge_expired(now)
            self._make_room(self._tickets)
            self._tickets[token] = ticket
        return {"ticket": token, "expires_in": self.ttl}

    def consume(
        self, token: str, scope: Mapping[str, object]
    ) -> ConnectionTicket | None:
        """Remove and return a matching ticket, preventing all replay attempts."""
        now = time.monotonic()
        with self._lock:
            self._purge_expired(now)
            ticket = self._tickets.pop(token, None)
        if ticket is None or ticket.scope != self.normalize_scope(scope):
            return None
        return ticket

    def clear(self) -> None:
        """Invalidate every outstanding ticket during integration unload."""
        with self._lock:
            self._tickets.clear()
            self._grants.clear()

    def exchange_for_grant(
        self, token: str, scope: Mapping[str, object], grant_ttl: int = 300
    ) -> str | None:
        """Consume a ticket and return a scoped grant suitable for HTTP Range requests."""
        ticket = self.consume(token, scope)
        if ticket is None:
            return None
        grant = secrets.token_urlsafe(32)
        with self._lock:
            self._purge_expired(time.monotonic())
            self._make_room(self._grants)
            self._grants[grant] = ConnectionTicket(
                ticket.user_id,
                ticket.scope,
                time.monotonic() + grant_ttl,
            )
        return grant

    def validate_grant(
        self, token: str, scope: Mapping[str, object]
    ) -> ConnectionTicket | None:
        """Validate a reusable but short-lived grant against its exact scope."""
        now = time.monotonic()
        with self._lock:
            grant = self._grants.get(token)
            if grant and grant.expires_at <= now:
                self._grants.pop(token, None)
                grant = None
        if grant is None or grant.scope != self.normalize_scope(scope):
            return None
        return grant

    def _purge_expired(self, now: float) -> None:
        expired = [
            token for token, ticket in self._tickets.items() if ticket.expires_at <= now
        ]
        for token in expired:
            self._tickets.pop(token, None)
        expired_grants = [
            token for token, grant in self._grants.items() if grant.expires_at <= now
        ]
        for token in expired_grants:
            self._grants.pop(token, None)

    def _make_room(self, registry: dict[str, ConnectionTicket]) -> None:
        """Bound transient authorization state under request floods."""
        while len(registry) >= self.max_entries:
            oldest = min(registry, key=lambda token: registry[token].expires_at)
            registry.pop(oldest, None)

    def snapshot(self) -> dict[str, int]:
        """Return token counts without token values, users, or scopes."""
        with self._lock:
            self._purge_expired(time.monotonic())
            return {
                "pending_tickets": len(self._tickets),
                "active_grants": len(self._grants),
            }
